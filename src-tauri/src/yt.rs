//! Optional YouTube support through the external `yt-dlp` program.
//!
//! This is OFF by default. Nothing here runs unless the user switches it on in Settings and then
//! installs yt-dlp from inside the app. Glasklang itself still has no HTTP client: the download of
//! yt-dlp uses Windows' own `curl.exe`, and everything else is done by yt-dlp.

use super::{allow_path, err, run_scan, AppState, CmdResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

#[derive(Serialize)]
pub struct YtStatus {
    installed: bool,
    version: Option<String>,
}

#[derive(Serialize)]
pub struct YtItem {
    id: String,
    title: String,
    channel: String,
    duration: f64,
}

fn tools_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("tools")
}

fn exe_path(state: &AppState) -> PathBuf {
    tools_dir(state).join(if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" })
}

fn cache_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("yt-cache")
}

/// No console window flashing up when a helper program starts.
fn hide(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn run(exe: &Path, args: &[String]) -> Result<std::process::Output, String> {
    let mut c = Command::new(exe);
    c.args(args);
    hide(&mut c);
    c.output().map_err(err)
}

fn tail(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    let n = lines.len().saturating_sub(3);
    lines[n..].join(" | ")
}

fn valid_id(id: &str) -> bool {
    id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub async fn yt_status(state: State<'_, AppState>) -> CmdResult<YtStatus> {
    let exe = exe_path(&state);
    if !exe.is_file() {
        return Ok(YtStatus { installed: false, version: None });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let version = run(&exe, &["--version".to_string()])
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
        YtStatus { installed: version.is_some(), version }
    })
    .await
    .map_err(err)
}

/// Download yt-dlp.exe from the official yt-dlp GitHub release (only when the user presses Install).
#[tauri::command]
pub async fn yt_install(state: State<'_, AppState>) -> CmdResult<()> {
    if !cfg!(windows) {
        return Err("Installing yt-dlp is only supported on Windows.".to_string());
    }
    let dir = tools_dir(&state);
    let exe = exe_path(&state);
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&dir).map_err(err)?;
        let tmp = dir.join("yt-dlp.download");
        let mut c = Command::new("curl.exe");
        c.args(["-L", "--fail", "--silent", "--show-error", "-o"]).arg(&tmp).arg(YTDLP_URL);
        hide(&mut c);
        let out = c.output().map_err(|e| format!("Could not run curl.exe: {e}"))?;
        if !out.status.success() {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("Download failed: {}", tail(&out.stderr)));
        }
        std::fs::rename(&tmp, &exe).map_err(err)?;
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Let yt-dlp update itself (YouTube changes often, so old versions stop working).
#[tauri::command]
pub async fn yt_update(state: State<'_, AppState>) -> CmdResult<String> {
    let exe = exe_path(&state);
    if !exe.is_file() {
        return Err("yt-dlp is not installed.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let out = run(&exe, &["-U".to_string()])?;
        if out.status.success() {
            Ok(tail(&out.stdout))
        } else {
            Err(tail(&out.stderr))
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn yt_search(state: State<'_, AppState>, query: String) -> CmdResult<Vec<YtItem>> {
    let q = query.trim().to_string();
    if q.is_empty() || q.len() > 200 {
        return Err("Type something to search for.".to_string());
    }
    let exe = exe_path(&state);
    if !exe.is_file() {
        return Err("yt-dlp is not installed.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<YtItem>, String> {
        let args = vec![
            "--flat-playlist".to_string(),
            "--dump-json".to_string(),
            "--no-warnings".to_string(),
            format!("ytsearch15:{q}"),
        ];
        let out = run(&exe, &args)?;
        let mut items = Vec::new();
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            let id = v["id"].as_str().unwrap_or("").to_string();
            if !valid_id(&id) {
                continue;
            }
            items.push(YtItem {
                id,
                title: v["title"].as_str().unwrap_or("Untitled").to_string(),
                channel: v["channel"].as_str().or_else(|| v["uploader"].as_str()).unwrap_or("").to_string(),
                duration: v["duration"].as_f64().unwrap_or(0.0),
            });
        }
        if items.is_empty() && !out.status.success() {
            return Err(format!("Search failed: {}", tail(&out.stderr)));
        }
        Ok(items)
    })
    .await
    .map_err(err)?
}

/// Download the audio of one video. `save = false` puts it in a temporary cache (stream-like
/// playback); `save = true` puts it in the user's folder and adds it to the library.
#[tauri::command]
pub async fn yt_fetch(app: AppHandle, state: State<'_, AppState>, id: String, save: bool, dest: Option<String>) -> CmdResult<String> {
    if !valid_id(&id) {
        return Err("That is not a valid video id.".to_string());
    }
    let exe = exe_path(&state);
    if !exe.is_file() {
        return Err("yt-dlp is not installed.".to_string());
    }
    let dir: PathBuf = if save {
        match dest.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            Some(d) => PathBuf::from(d),
            None => {
                let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map_err(err)?;
                PathBuf::from(home).join("Music").join("Glasklang")
            }
        }
    } else {
        cache_dir(&state)
    };
    std::fs::create_dir_all(&dir).map_err(err)?;

    // streamed songs are cached: playing the same one again is instant
    if !save {
        let tag = format!("[{id}]");
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.contains(&tag) && !name.ends_with(".part") && !name.ends_with(".ytdl") {
                    allow_path(&app, &e.path());
                    return Ok(e.path().to_string_lossy().to_string());
                }
            }
        }
    }

    let dir_for_job = dir.clone();
    let path = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let args = vec![
            "-f".to_string(),
            "bestaudio[ext=m4a]/bestaudio".to_string(),
            "--no-playlist".to_string(),
            "--no-warnings".to_string(),
            "--windows-filenames".to_string(),
            "-q".to_string(),
            "--no-simulate".to_string(),
            "--print".to_string(),
            "after_move:filepath".to_string(),
            "-P".to_string(),
            dir_for_job.to_string_lossy().to_string(),
            "-o".to_string(),
            "%(title).150B [%(id)s].%(ext)s".to_string(),
            format!("https://www.youtube.com/watch?v={id}"),
        ];
        let out = run(&exe, &args)?;
        if !out.status.success() {
            return Err(format!("Download failed: {}", tail(&out.stderr)));
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        let line = stdout.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("").to_string();
        if line.is_empty() || !Path::new(&line).is_file() {
            return Err("yt-dlp finished but no file was created.".to_string());
        }
        Ok(line)
    })
    .await
    .map_err(err)??;

    let p = PathBuf::from(&path);
    allow_path(&app, &p);
    if save {
        run_scan(app, state.db_path.clone(), vec![p]).await?;
    }
    Ok(path)
}

/// Delete the temporary files of streamed songs.
#[tauri::command]
pub async fn yt_clear_cache(state: State<'_, AppState>) -> CmdResult<()> {
    let dir = cache_dir(&state);
    if dir.is_dir() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}
