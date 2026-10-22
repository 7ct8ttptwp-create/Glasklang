//! Tiny M3U / M3U8 reader and writer.

use std::path::{Path, PathBuf};

/// One line of an exported playlist.
pub struct M3uEntry {
    pub duration_secs: i64,
    pub title: String,
    pub path: String,
}

/// Build the text of an extended M3U file.
pub fn build_m3u(entries: &[M3uEntry]) -> String {
    let mut out = String::from("#EXTM3U\n");
    for e in entries {
        out.push_str(&format!("#EXTINF:{},{}\n{}\n", e.duration_secs, e.title.replace('\n', " "), e.path));
    }
    out
}

/// Parse an M3U file into file paths. Relative paths are resolved against `base_dir`.
/// Comment lines, blank lines and URLs are skipped.
pub fn parse_m3u(text: &str, base_dir: &Path) -> Vec<PathBuf> {
    let text = text.trim_start_matches('\u{feff}');
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.contains("://") && !line.starts_with("file://") {
            continue; // streams are not supported (and we are offline anyway)
        }
        let line = line.strip_prefix("file:///").unwrap_or(line);
        let p = PathBuf::from(line);
        if p.is_absolute() {
            out.push(p);
        } else {
            out.push(base_dir.join(p));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let text = build_m3u(&[
            M3uEntry { duration_secs: 200, title: "A - One".into(), path: "/music/one.mp3".into() },
            M3uEntry { duration_secs: 100, title: "B - Two".into(), path: "/music/two.mp3".into() },
        ]);
        assert!(text.starts_with("#EXTM3U\n"));
        let parsed = parse_m3u(&text, Path::new("/base"));
        assert_eq!(parsed, vec![PathBuf::from("/music/one.mp3"), PathBuf::from("/music/two.mp3")]);
    }

    #[test]
    fn relative_paths_use_base_dir_and_junk_is_skipped() {
        let text = "\u{feff}#EXTM3U\n\n# comment\nsub/a.mp3\nhttp://example.com/stream\n";
        let parsed = parse_m3u(text, Path::new("/lists"));
        assert_eq!(parsed, vec![PathBuf::from("/lists").join("sub/a.mp3")]);
    }
}
