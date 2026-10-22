//! SQLite library: tracks, scanned folders, playlists and a tiny key/value store.
//! WAL mode lets the scanner use its own connection while the UI keeps reading.

use anyhow::Result;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

use crate::tags::TrackMeta;

#[derive(Debug, Clone, Serialize)]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<u32>,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub track_count: i64,
}

pub struct Db {
    conn: Connection,
}

const TRACK_COLS: &str =
    "id, path, title, artist, album, album_artist, track_no, disc_no, year, duration_ms";

fn row_to_track(r: &rusqlite::Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        artist: r.get(3)?,
        album: r.get(4)?,
        album_artist: r.get(5)?,
        track_no: r.get(6)?,
        disc_no: r.get(7)?,
        year: r.get(8)?,
        duration_ms: r.get(9)?,
    })
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS tracks (
                 id INTEGER PRIMARY KEY,
                 path TEXT NOT NULL UNIQUE,
                 title TEXT NOT NULL,
                 artist TEXT NOT NULL,
                 album TEXT NOT NULL,
                 album_artist TEXT NOT NULL,
                 track_no INTEGER,
                 disc_no INTEGER,
                 year INTEGER,
                 duration_ms INTEGER NOT NULL DEFAULT 0,
                 mtime INTEGER NOT NULL DEFAULT 0,
                 size INTEGER NOT NULL DEFAULT 0,
                 added_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
             );
             CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
             CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE);
             CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS playlists (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL,
                 created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
             );
             CREATE TABLE IF NOT EXISTS playlist_tracks (
                 playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                 position INTEGER NOT NULL,
                 track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                 PRIMARY KEY (playlist_id, position)
             );
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(Self { conn })
    }

    // ---------- tracks ----------

    /// All tracks, sorted the way the UI wants them by default.
    pub fn all_tracks(&self) -> Result<Vec<Track>> {
        let sql = format!(
            "SELECT {TRACK_COLS} FROM tracks
             ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE,
                      COALESCE(disc_no, 1), COALESCE(track_no, 0), title COLLATE NOCASE"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], row_to_track)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// (mtime, size) of a known file, used to skip unchanged files when rescanning.
    pub fn fingerprint(&self, path: &str) -> Result<Option<(i64, i64)>> {
        Ok(self
            .conn
            .query_row("SELECT mtime, size FROM tracks WHERE path = ?1", [path], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?)
    }

    pub fn upsert_track(&self, path: &str, m: &TrackMeta, mtime: i64, size: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO tracks (path, title, artist, album, album_artist, track_no, disc_no, year, duration_ms, mtime, size)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(path) DO UPDATE SET
                 title = excluded.title, artist = excluded.artist, album = excluded.album,
                 album_artist = excluded.album_artist, track_no = excluded.track_no,
                 disc_no = excluded.disc_no, year = excluded.year,
                 duration_ms = excluded.duration_ms, mtime = excluded.mtime, size = excluded.size",
            params![
                path, m.title, m.artist, m.album, m.album_artist, m.track_no, m.disc_no, m.year,
                m.duration_ms as i64, mtime, size
            ],
        )?;
        Ok(())
    }

    pub fn all_paths(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT path FROM tracks")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn delete_track_path(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM tracks WHERE path = ?1", [path])?;
        Ok(())
    }

    pub fn track_ids_by_paths(&self, paths: &[String]) -> Result<Vec<i64>> {
        let mut out = Vec::new();
        let mut stmt = self.conn.prepare("SELECT id FROM tracks WHERE path = ?1")?;
        for p in paths {
            if let Some(id) = stmt.query_row([p], |r| r.get::<_, i64>(0)).optional()? {
                out.push(id);
            }
        }
        Ok(out)
    }

    pub fn begin(&self) -> Result<()> {
        self.conn.execute_batch("BEGIN")?;
        Ok(())
    }

    pub fn commit(&self) -> Result<()> {
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }

    pub fn rollback(&self) {
        let _ = self.conn.execute_batch("ROLLBACK");
    }

    // ---------- folders ----------

    pub fn add_folder(&self, path: &str) -> Result<()> {
        self.conn.execute("INSERT OR IGNORE INTO folders (path) VALUES (?1)", [path])?;
        Ok(())
    }

    pub fn folders(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT path FROM folders ORDER BY path")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Forget a folder and every track that lives under it.
    pub fn remove_folder(&self, folder: &str) -> Result<()> {
        self.conn.execute("DELETE FROM folders WHERE path = ?1", [folder])?;
        let root = Path::new(folder);
        for p in self.all_paths()? {
            if Path::new(&p).starts_with(root) {
                self.delete_track_path(&p)?;
            }
        }
        Ok(())
    }

    // ---------- playlists ----------

    pub fn playlists(&self) -> Result<Vec<Playlist>> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.name, COUNT(pt.track_id)
             FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
             GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Playlist { id: r.get(0)?, name: r.get(1)?, track_count: r.get(2)? })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn create_playlist(&self, name: &str) -> Result<i64> {
        self.conn.execute("INSERT INTO playlists (name) VALUES (?1)", [name])?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn rename_playlist(&self, id: i64, name: &str) -> Result<()> {
        self.conn.execute("UPDATE playlists SET name = ?1 WHERE id = ?2", params![name, id])?;
        Ok(())
    }

    pub fn delete_playlist(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn playlist_tracks(&self, id: i64) -> Result<Vec<Track>> {
        let sql = format!(
            "SELECT {} FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
             WHERE pt.playlist_id = ?1 ORDER BY pt.position",
            TRACK_COLS.split(", ").map(|c| format!("t.{c}")).collect::<Vec<_>>().join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([id], row_to_track)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Replace the whole track list of a playlist (used for reorder / remove).
    pub fn playlist_set(&self, id: i64, track_ids: &[i64]) -> Result<()> {
        self.begin()?;
        let res = (|| -> Result<()> {
            self.conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
            let mut stmt = self.conn.prepare(
                "INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)",
            )?;
            for (pos, tid) in track_ids.iter().enumerate() {
                stmt.execute(params![id, pos as i64, tid])?;
            }
            Ok(())
        })();
        match res {
            Ok(()) => self.commit(),
            Err(e) => {
                self.rollback();
                Err(e)
            }
        }
    }

    pub fn playlist_append(&self, id: i64, track_ids: &[i64]) -> Result<()> {
        let mut ids: Vec<i64> = self.playlist_tracks(id)?.into_iter().map(|t| t.id).collect();
        ids.extend_from_slice(track_ids);
        self.playlist_set(id, &ids)
    }

    // ---------- key/value ----------

    pub fn kv_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// "Delete all app data": empties every table.
    pub fn wipe(&self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks;
             DELETE FROM folders; DELETE FROM kv; VACUUM;",
        )?;
        Ok(())
    }

    /// Helper kept for completeness / tests: how many tracks match any of the given paths.
    pub fn count_paths(&self, paths: &[String]) -> Result<i64> {
        if paths.is_empty() {
            return Ok(0);
        }
        let marks = vec!["?"; paths.len()].join(",");
        let sql = format!("SELECT COUNT(*) FROM tracks WHERE path IN ({marks})");
        Ok(self.conn.query_row(&sql, params_from_iter(paths.iter()), |r| r.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tags::fallback_meta;

    fn meta(title: &str, artist: &str, album: &str, no: u32) -> TrackMeta {
        TrackMeta {
            title: title.into(),
            artist: artist.into(),
            album: album.into(),
            album_artist: artist.into(),
            track_no: Some(no),
            disc_no: None,
            year: Some(2020),
            duration_ms: 180_000,
        }
    }

    fn seeded() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.upsert_track("/m/b2.mp3", &meta("Two", "B Band", "Album B", 2), 1, 10).unwrap();
        db.upsert_track("/m/b1.mp3", &meta("One", "B Band", "Album B", 1), 1, 10).unwrap();
        db.upsert_track("/m/a1.mp3", &meta("Alpha", "A Band", "Album A", 1), 1, 10).unwrap();
        db
    }

    #[test]
    fn tracks_are_sorted_artist_album_track() {
        let titles: Vec<_> = seeded().all_tracks().unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(titles, vec!["Alpha", "One", "Two"]);
    }

    #[test]
    fn upsert_updates_instead_of_duplicating() {
        let db = seeded();
        db.upsert_track("/m/a1.mp3", &meta("Alpha v2", "A Band", "Album A", 1), 2, 11).unwrap();
        let all = db.all_tracks().unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|t| t.title == "Alpha v2"));
        assert_eq!(db.fingerprint("/m/a1.mp3").unwrap(), Some((2, 11)));
        assert_eq!(db.fingerprint("/nope").unwrap(), None);
    }

    #[test]
    fn playlist_create_append_reorder_remove() {
        let db = seeded();
        let ids: Vec<i64> = db.all_tracks().unwrap().into_iter().map(|t| t.id).collect();
        let pl = db.create_playlist("Mix").unwrap();
        db.playlist_append(pl, &ids).unwrap();
        assert_eq!(db.playlists().unwrap()[0].track_count, 3);

        let mut reversed = ids.clone();
        reversed.reverse();
        db.playlist_set(pl, &reversed).unwrap();
        let got: Vec<i64> = db.playlist_tracks(pl).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(got, reversed);

        // the same track may appear twice
        db.playlist_append(pl, &[ids[0]]).unwrap();
        assert_eq!(db.playlist_tracks(pl).unwrap().len(), 4);

        db.rename_playlist(pl, "Renamed").unwrap();
        assert_eq!(db.playlists().unwrap()[0].name, "Renamed");
        db.delete_playlist(pl).unwrap();
        assert!(db.playlists().unwrap().is_empty());
    }

    #[test]
    fn deleting_a_track_removes_it_from_playlists() {
        let db = seeded();
        let ids: Vec<i64> = db.all_tracks().unwrap().into_iter().map(|t| t.id).collect();
        let pl = db.create_playlist("Mix").unwrap();
        db.playlist_set(pl, &ids).unwrap();
        db.delete_track_path("/m/a1.mp3").unwrap();
        assert_eq!(db.playlist_tracks(pl).unwrap().len(), 2);
    }

    #[test]
    fn remove_folder_removes_only_its_tracks() {
        let db = Db::open_in_memory().unwrap();
        let m = fallback_meta(Path::new("x.mp3"));
        db.upsert_track("/music/a/1.mp3", &m, 1, 1).unwrap();
        db.upsert_track("/music/b/2.mp3", &m, 1, 1).unwrap();
        db.add_folder("/music/a").unwrap();
        db.remove_folder("/music/a").unwrap();
        assert_eq!(db.all_paths().unwrap(), vec!["/music/b/2.mp3".to_string()]);
        assert!(db.folders().unwrap().is_empty());
    }

    #[test]
    fn kv_roundtrip_and_wipe() {
        let db = seeded();
        assert_eq!(db.kv_get("k").unwrap(), None);
        db.kv_set("k", "v1").unwrap();
        db.kv_set("k", "v2").unwrap();
        assert_eq!(db.kv_get("k").unwrap().as_deref(), Some("v2"));
        db.wipe().unwrap();
        assert!(db.all_tracks().unwrap().is_empty());
        assert_eq!(db.kv_get("k").unwrap(), None);
    }

    #[test]
    fn track_ids_by_paths_skips_unknown() {
        let db = seeded();
        let ids = db
            .track_ids_by_paths(&["/m/a1.mp3".into(), "/unknown.mp3".into(), "/m/b1.mp3".into()])
            .unwrap();
        assert_eq!(ids.len(), 2);
        assert_eq!(db.count_paths(&["/m/a1.mp3".into()]).unwrap(), 1);
    }
}
