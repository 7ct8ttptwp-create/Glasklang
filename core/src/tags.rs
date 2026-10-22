//! Tag reading (ID3, Vorbis, MP4 ...) and cover-art extraction via `lofty`.
//! Everything here is defensive: a broken file never panics, it just falls back.

use anyhow::Result;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::tag::{Accessor, ItemKey};
use std::path::Path;

pub const UNKNOWN_ARTIST: &str = "Unknown Artist";
pub const UNKNOWN_ALBUM: &str = "Unknown Album";

/// Metadata we keep in the library for every track.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackMeta {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<u32>,
    pub duration_ms: u64,
}

/// Metadata made only from the file name. Used when tags are missing or the file is damaged.
pub fn fallback_meta(path: &Path) -> TrackMeta {
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    TrackMeta {
        title,
        artist: UNKNOWN_ARTIST.to_string(),
        album: UNKNOWN_ALBUM.to_string(),
        album_artist: UNKNOWN_ARTIST.to_string(),
        track_no: None,
        disc_no: None,
        year: None,
        duration_ms: 0,
    }
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Read tags and duration. Returns an error only if the file cannot be parsed at all.
pub fn read_meta(path: &Path) -> Result<TrackMeta> {
    let tagged = lofty::read_from_path(path)?;
    let duration_ms = tagged.properties().duration().as_millis() as u64;
    let fb = fallback_meta(path);

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let Some(tag) = tag else {
        return Ok(TrackMeta { duration_ms, ..fb });
    };

    let title = non_empty(tag.title().map(|s| s.to_string())).unwrap_or(fb.title);
    let artist = non_empty(tag.artist().map(|s| s.to_string()));
    let album = non_empty(tag.album().map(|s| s.to_string())).unwrap_or(fb.album);
    let album_artist = non_empty(tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string()));

    // If only one of artist / album artist exists, use it for both.
    let artist_final = artist.clone().or_else(|| album_artist.clone()).unwrap_or(fb.artist);
    let album_artist_final = album_artist.or(artist).unwrap_or_else(|| UNKNOWN_ARTIST.to_string());

    Ok(TrackMeta {
        title,
        artist: artist_final,
        album,
        album_artist: album_artist_final,
        track_no: tag.track(),
        disc_no: tag.disk(),
        year: tag.year(),
        duration_ms,
    })
}

const FOLDER_COVERS: &[&str] = &[
    "cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "folder.png",
    "front.jpg", "front.png", "album.jpg", "albumart.jpg",
];

/// Cover art: embedded picture first, then a cover image in the same folder.
/// Returns raw image bytes (JPEG/PNG), or None.
pub fn read_cover(path: &Path) -> Option<Vec<u8>> {
    if let Ok(tagged) = lofty::read_from_path(path) {
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        if let Some(tag) = tag {
            let pics = tag.pictures();
            let pic = pics
                .iter()
                .find(|p| p.pic_type() == PictureType::CoverFront)
                .or_else(|| pics.first());
            if let Some(p) = pic {
                if !p.data().is_empty() {
                    return Some(p.data().to_vec());
                }
            }
        }
    }
    let dir = path.parent()?;
    for name in FOLDER_COVERS {
        let candidate = dir.join(name);
        if candidate.is_file() {
            if let Ok(bytes) = std::fs::read(&candidate) {
                if !bytes.is_empty() {
                    return Some(bytes);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_uses_file_stem() {
        let m = fallback_meta(Path::new("C:/Music/My Song.mp3"));
        assert_eq!(m.title, "My Song");
        assert_eq!(m.artist, UNKNOWN_ARTIST);
        assert_eq!(m.album, UNKNOWN_ALBUM);
    }

    #[test]
    fn garbage_file_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("broken.mp3");
        std::fs::write(&p, b"this is definitely not audio").unwrap();
        // Either an error or an empty-tag result is fine, it just must not panic.
        let _ = read_meta(&p);
        assert!(read_cover(&p).is_none());
    }

    #[test]
    fn missing_file_is_an_error() {
        assert!(read_meta(Path::new("/definitely/not/here.mp3")).is_err());
    }

    #[test]
    fn folder_cover_is_found() {
        let dir = tempfile::tempdir().unwrap();
        let song = dir.path().join("a.mp3");
        std::fs::write(&song, b"nope").unwrap();
        std::fs::write(dir.path().join("cover.jpg"), b"\xFF\xD8\xFF fake jpeg").unwrap();
        let cover = read_cover(&song).expect("cover.jpg should be picked up");
        assert!(cover.starts_with(&[0xFF, 0xD8]));
    }
}
