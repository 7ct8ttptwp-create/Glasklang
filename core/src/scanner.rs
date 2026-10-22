//! Folder / file scanner. Skips files that did not change (same mtime + size),
//! survives unreadable files and never deletes anything just because a drive is unplugged.

use anyhow::Result;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::db::Db;
use crate::tags;

pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "oga", "opus", "aac", "m4a", "m4b", "wma"];

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct ScanStats {
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub removed: usize,
    /// Files whose tags could not be read (they are still added, named after the file).
    pub bad_tags: usize,
}

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn fingerprint(path: &Path) -> (i64, i64) {
    match std::fs::metadata(path) {
        Ok(m) => {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            (mtime, m.len() as i64)
        }
        Err(_) => (0, 0),
    }
}

/// Index one file. Returns (was_new, bad_tags) or None if unchanged.
fn index_file(db: &Db, path: &Path) -> Result<Option<(bool, bool)>> {
    let key = path.to_string_lossy().to_string();
    let (mtime, size) = fingerprint(path);
    let existing = db.fingerprint(&key)?;
    if existing == Some((mtime, size)) {
        return Ok(None);
    }
    let (meta, bad) = match tags::read_meta(path) {
        Ok(m) => (m, false),
        Err(_) => (tags::fallback_meta(path), true),
    };
    db.upsert_track(&key, &meta, mtime, size)?;
    Ok(Some((existing.is_none(), bad)))
}

/// Scan files and/or folders. `progress` is called with the number of files looked at so far.
/// Folders are remembered so they can be rescanned later.
pub fn scan_paths(db: &Db, paths: &[PathBuf], progress: &mut dyn FnMut(usize)) -> Result<ScanStats> {
    let mut stats = ScanStats::default();
    let mut seen_count = 0usize;

    db.begin()?;
    let result = (|| -> Result<()> {
        for root in paths {
            if root.is_dir() {
                db.add_folder(&root.to_string_lossy())?;
                let mut seen: HashSet<String> = HashSet::new();
                let mut walk_ok = true;
                for entry in WalkDir::new(root).follow_links(false) {
                    let entry = match entry {
                        Ok(e) => e,
                        Err(_) => {
                            walk_ok = false; // unreadable subfolder: do not prune anything this round
                            continue;
                        }
                    };
                    if !entry.file_type().is_file() || !is_audio(entry.path()) {
                        continue;
                    }
                    seen_count += 1;
                    if seen_count % 50 == 0 {
                        progress(seen_count);
                    }
                    seen.insert(entry.path().to_string_lossy().to_string());
                    record(&mut stats, index_file(db, entry.path())?);
                }
                if walk_ok {
                    // Remove tracks of this folder whose file is really gone.
                    for p in db.all_paths()? {
                        let pp = Path::new(&p);
                        if pp.starts_with(root) && !seen.contains(&p) && !pp.exists() {
                            db.delete_track_path(&p)?;
                            stats.removed += 1;
                        }
                    }
                }
            } else if root.is_file() && is_audio(root) {
                seen_count += 1;
                record(&mut stats, index_file(db, root)?);
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => db.commit()?,
        Err(e) => {
            // Roll back the half-finished batch; the library stays consistent.
            db.rollback();
            return Err(e);
        }
    }
    progress(seen_count);
    Ok(stats)
}

fn record(stats: &mut ScanStats, r: Option<(bool, bool)>) {
    match r {
        None => stats.unchanged += 1,
        Some((is_new, bad)) => {
            if is_new {
                stats.added += 1;
            } else {
                stats.updated += 1;
            }
            if bad {
                stats.bad_tags += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A few bytes shaped like valid MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz).
    fn fake_mp3() -> Vec<u8> {
        let mut v = Vec::new();
        for _ in 0..40 {
            v.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
            v.extend(std::iter::repeat(0u8).take(413));
        }
        v
    }

    #[test]
    fn extension_filter() {
        assert!(is_audio(Path::new("a.MP3")));
        assert!(is_audio(Path::new("a.flac")));
        assert!(!is_audio(Path::new("a.txt")));
        assert!(!is_audio(Path::new("noext")));
    }

    #[test]
    fn scan_adds_skips_and_prunes() {
        let dir = tempfile::tempdir().unwrap();
        let music = dir.path().join("music");
        fs::create_dir_all(music.join("sub")).unwrap();
        fs::write(music.join("one.mp3"), fake_mp3()).unwrap();
        fs::write(music.join("sub/two.mp3"), fake_mp3()).unwrap();
        fs::write(music.join("notes.txt"), "ignore me").unwrap();
        fs::write(music.join("broken.mp3"), b"garbage, not audio").unwrap();

        let db = Db::open_in_memory().unwrap();
        let mut calls = 0;
        let s1 = scan_paths(&db, &[music.clone()], &mut |_| calls += 1).unwrap();
        assert_eq!(s1.added, 3, "one.mp3, two.mp3 and broken.mp3 are added");
        assert_eq!(db.all_tracks().unwrap().len(), 3);
        assert_eq!(db.folders().unwrap().len(), 1);
        assert!(calls >= 1);

        // Broken file is still listed, named after its file.
        assert!(db.all_tracks().unwrap().iter().any(|t| t.title == "broken"));

        // Second scan: nothing changed.
        let s2 = scan_paths(&db, &[music.clone()], &mut |_| {}).unwrap();
        assert_eq!(s2.added, 0);
        assert_eq!(s2.unchanged, 3);

        // Delete a file: it is pruned on the next scan.
        fs::remove_file(music.join("sub/two.mp3")).unwrap();
        let s3 = scan_paths(&db, &[music.clone()], &mut |_| {}).unwrap();
        assert_eq!(s3.removed, 1);
        assert_eq!(db.all_tracks().unwrap().len(), 2);
    }

    #[test]
    fn missing_folder_does_not_wipe_library() {
        let dir = tempfile::tempdir().unwrap();
        let music = dir.path().join("music");
        fs::create_dir_all(&music).unwrap();
        fs::write(music.join("one.mp3"), fake_mp3()).unwrap();
        let db = Db::open_in_memory().unwrap();
        scan_paths(&db, &[music.clone()], &mut |_| {}).unwrap();

        // Simulate an unplugged drive: the folder disappears.
        fs::remove_dir_all(&music).unwrap();
        let s = scan_paths(&db, &[music.clone()], &mut |_| {}).unwrap();
        assert_eq!(s.removed, 0);
        assert_eq!(db.all_tracks().unwrap().len(), 1, "tracks stay while the drive is away");
    }

    #[test]
    fn single_files_can_be_added() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("solo.mp3");
        fs::write(&f, fake_mp3()).unwrap();
        let db = Db::open_in_memory().unwrap();
        let s = scan_paths(&db, &[f], &mut |_| {}).unwrap();
        assert_eq!(s.added, 1);
        assert!(db.folders().unwrap().is_empty());
    }
}
