// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Glasklang backend.
//!
//! The Rust side does only what a browser cannot: read files and tags, keep the SQLite
//! library, copy background files, draw the Windows window material and the tray icon.
//! Playback itself happens in the web view (see `src/lib/audio.ts`).
//!
//! Privacy: this program never opens a network connection by itself. There is no HTTP client in the
//! dependency list, and the window's content-security-policy forbids outbound requests. The one
//! exception is the optional YouTube feature (`yt.rs`), which is off until the user enables it.

mod yt;

use base64::Engine as _;
use glasklang_core::db::{Db, Playlist, Track};
use glasklang_core::m3u::{self, M3uEntry};
use glasklang_core::scanner::{self, ScanStats};
use glasklang_core::tags;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

/// Shared state: one SQLite connection for the UI plus where everything lives on disk.
struct AppState {
    db: Mutex<Db>,
    db_path: PathBuf,
    data_dir: PathBuf,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn with_db<T>(state: &State<'_, AppState>, f: impl FnOnce(&Db) -> anyhow::Result<T>) -> CmdResult<T> {
    let guard = state.db.lock().map_err(|_| "library lock was poisoned".to_string())?;
    f(&guard).map_err(err)
}

// ---------------------------------------------------------------------------------------------
// Logging (local only)
// ---------------------------------------------------------------------------------------------

fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("crash.log")
}

fn append_log(data_dir: &Path, line: &str) {
    let path = log_path(data_dir);
    // Keep the log small: start over once it passes 1 MB.
    if fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = fs::remove_file(&path);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{secs}] {line}");
    }
}

// ---------------------------------------------------------------------------------------------
// Asset-protocol scope: the web view may only read files we explicitly allow.
// ---------------------------------------------------------------------------------------------

fn allow_path(app: &AppHandle, p: &Path) {
    let scope = app.asset_protocol_scope();
    if p.is_dir() {
        let _ = scope.allow_directory(p, true);
    } else if p.is_file() {
        let _ = scope.allow_file(p);
        if let Some(parent) = p.parent() {
            let _ = scope.allow_directory(parent, false);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Library commands
// ---------------------------------------------------------------------------------------------

#[tauri::command]
async fn list_tracks(state: State<'_, AppState>) -> CmdResult<Vec<Track>> {
    with_db(&state, |db| db.all_tracks())
}

/// Add files and/or folders (drag & drop or the "Add folder" button).
/// Uses its own database connection so the UI stays responsive while scanning.
#[tauri::command]
async fn add_paths(app: AppHandle, state: State<'_, AppState>, paths: Vec<String>) -> CmdResult<ScanStats> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    for p in &paths {
        allow_path(&app, p);
    }
    run_scan(app, state.db_path.clone(), paths).await
}

#[tauri::command]
async fn rescan(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ScanStats> {
    let folders: Vec<PathBuf> = with_db(&state, |db| db.folders())?.into_iter().map(PathBuf::from).collect();
    for p in &folders {
        allow_path(&app, p);
    }
    run_scan(app, state.db_path.clone(), folders).await
}

async fn run_scan(app: AppHandle, db_path: PathBuf, paths: Vec<PathBuf>) -> CmdResult<ScanStats> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<ScanStats> {
        let db = Db::open(&db_path)?;
        let mut progress = |n: usize| {
            let _ = app.emit("scan-progress", n);
        };
        let stats = scanner::scan_paths(&db, &paths, &mut progress)?;
        // songs the user removed from the library stay removed even if their folder is scanned again
        for p in excluded_paths(&db) {
            let _ = db.delete_track_path(&p);
        }
        Ok(stats)
    })
    .await
    .map_err(err)?
    .map_err(err)
}

#[tauri::command]
async fn list_folders(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    with_db(&state, |db| db.folders())
}

#[tauri::command]
async fn remove_folder(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    with_db(&state, |db| db.remove_folder(&path))
}

const EXCLUDED_KEY: &str = "excluded";

/// Paths the user removed from the library (kept so a rescan does not bring them back).
fn excluded_paths(db: &Db) -> Vec<String> {
    db.kv_get(EXCLUDED_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Move a file to the Windows Recycle Bin (the path travels in an environment variable, never in the script).
fn recycle(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let script = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:GLK_PATH,'OnlyErrorDialogs','SendToRecycleBin')";
        let out = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("GLK_PATH", path)
            .creation_flags(0x0800_0000)
            .output()
            .map_err(err)?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
    #[cfg(not(windows))]
    {
        fs::remove_file(path).map_err(err)
    }
}

/// Remove songs from the library. With `delete_files` the files also go to the Recycle Bin.
#[tauri::command]
async fn remove_tracks(state: State<'_, AppState>, paths: Vec<String>, delete_files: bool) -> CmdResult<usize> {
    let mut done = 0usize;
    let mut first_err: Option<String> = None;
    let mut excluded = with_db(&state, |db| Ok(excluded_paths(db)))?;
    for p in &paths {
        if delete_files && Path::new(p).exists() {
            let owned = p.clone();
            let res = tauri::async_runtime::spawn_blocking(move || recycle(&owned)).await.map_err(err)?;
            if let Err(e) = res {
                first_err.get_or_insert(e);
                continue;
            }
        }
        with_db(&state, |db| db.delete_track_path(p))?;
        if !delete_files && !excluded.contains(p) {
            excluded.push(p.clone());
        }
        done += 1;
    }
    let json = serde_json::to_string(&excluded).map_err(err)?;
    with_db(&state, |db| db.kv_set(EXCLUDED_KEY, &json))?;
    match first_err {
        Some(e) if done == 0 => Err(format!("Could not move the file to the Recycle Bin: {e}")),
        _ => Ok(done),
    }
}

/// Forget which songs were removed; the next scan brings them back.
#[tauri::command]
async fn restore_removed(state: State<'_, AppState>) -> CmdResult<usize> {
    let n = with_db(&state, |db| Ok(excluded_paths(db).len()))?;
    with_db(&state, |db| db.kv_set(EXCLUDED_KEY, "[]"))?;
    Ok(n)
}

/// Raw cover image bytes (empty if the track has no cover).
#[tauri::command]
async fn get_cover(path: String) -> CmdResult<tauri::ipc::Response> {
    let bytes = tags::read_cover(Path::new(&path)).unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------------------------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------------------------

#[tauri::command]
async fn list_playlists(state: State<'_, AppState>) -> CmdResult<Vec<Playlist>> {
    with_db(&state, |db| db.playlists())
}

#[tauri::command]
async fn create_playlist(state: State<'_, AppState>, name: String) -> CmdResult<i64> {
    with_db(&state, |db| db.create_playlist(name.trim()))
}

#[tauri::command]
async fn rename_playlist(state: State<'_, AppState>, id: i64, name: String) -> CmdResult<()> {
    with_db(&state, |db| db.rename_playlist(id, name.trim()))
}

#[tauri::command]
async fn delete_playlist(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    with_db(&state, |db| db.delete_playlist(id))
}

#[tauri::command]
async fn playlist_tracks(state: State<'_, AppState>, id: i64) -> CmdResult<Vec<Track>> {
    with_db(&state, |db| db.playlist_tracks(id))
}

#[tauri::command]
async fn playlist_append(state: State<'_, AppState>, id: i64, track_ids: Vec<i64>) -> CmdResult<()> {
    with_db(&state, |db| db.playlist_append(id, &track_ids))
}

/// Replace the playlist contents (used for reorder and remove).
#[tauri::command]
async fn playlist_set(state: State<'_, AppState>, id: i64, track_ids: Vec<i64>) -> CmdResult<()> {
    with_db(&state, |db| db.playlist_set(id, &track_ids))
}

#[tauri::command]
async fn export_m3u(state: State<'_, AppState>, id: i64, dest: String) -> CmdResult<()> {
    let tracks = with_db(&state, |db| db.playlist_tracks(id))?;
    let entries: Vec<M3uEntry> = tracks
        .into_iter()
        .map(|t| M3uEntry {
            duration_secs: t.duration_ms / 1000,
            title: format!("{} - {}", t.artist, t.title),
            path: t.path,
        })
        .collect();
    fs::write(&dest, m3u::build_m3u(&entries)).map_err(err)
}

/// Import an .m3u / .m3u8 file as a new playlist. Files not yet in the library are added.
#[tauri::command]
async fn import_m3u(app: AppHandle, state: State<'_, AppState>, src: String) -> CmdResult<i64> {
    let bytes = fs::read(&src).map_err(err)?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let src_path = PathBuf::from(&src);
    let base = src_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let files: Vec<PathBuf> = m3u::parse_m3u(&text, &base).into_iter().filter(|p| p.is_file()).collect();
    for f in &files {
        allow_path(&app, f);
    }
    let name = src_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported playlist".to_string());
    with_db(&state, |db| {
        scanner::scan_paths(db, &files, &mut |_| {})?;
        let keys: Vec<String> = files.iter().map(|p| p.to_string_lossy().to_string()).collect();
        let ids = db.track_ids_by_paths(&keys)?;
        let pl = db.create_playlist(&name)?;
        db.playlist_set(pl, &ids)?;
        Ok(pl)
    })
}

// ---------------------------------------------------------------------------------------------
// Settings (JSON strings in SQLite) and files for themes / backgrounds
// ---------------------------------------------------------------------------------------------

#[tauri::command]
async fn kv_get(state: State<'_, AppState>, key: String) -> CmdResult<Option<String>> {
    with_db(&state, |db| db.kv_get(&key))
}

#[tauri::command]
async fn kv_set(state: State<'_, AppState>, key: String, value: String) -> CmdResult<()> {
    with_db(&state, |db| db.kv_set(&key, &value))
}

fn backgrounds_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("backgrounds")
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if cleaned.is_empty() { "background".to_string() } else { cleaned }
}

fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    dir.join(format!("{stamp}_{}", safe_name(name)))
}

/// Copy a user-chosen image or video into our data folder so the theme keeps working
/// even if the original file is moved or deleted.
#[tauri::command]
async fn import_background(app: AppHandle, state: State<'_, AppState>, src: String) -> CmdResult<String> {
    let dir = backgrounds_dir(&state);
    fs::create_dir_all(&dir).map_err(err)?;
    let name = Path::new(&src).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let dest = unique_dest(&dir, &name);
    fs::copy(&src, &dest).map_err(err)?;
    allow_path(&app, &dir);
    Ok(dest.to_string_lossy().to_string())
}

/// Used when importing a theme file that carries its own background (base64).
#[tauri::command]
async fn import_background_b64(app: AppHandle, state: State<'_, AppState>, name: String, data: String) -> CmdResult<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(err)?;
    let dir = backgrounds_dir(&state);
    fs::create_dir_all(&dir).map_err(err)?;
    let dest = unique_dest(&dir, &name);
    fs::write(&dest, bytes).map_err(err)?;
    allow_path(&app, &dir);
    Ok(dest.to_string_lossy().to_string())
}

/// Read a background file as base64 so it can travel inside a single theme file (max 40 MB).
#[tauri::command]
async fn file_to_base64(path: String) -> CmdResult<String> {
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > 40 * 1024 * 1024 {
        return Err("file is larger than 40 MB".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn read_text_file(path: String) -> CmdResult<String> {
    let bytes = fs::read(&path).map_err(err)?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
async fn write_text_file(path: String, text: String) -> CmdResult<()> {
    fs::write(&path, text).map_err(err)
}

/// List images in a folder (for the background slideshow) and allow the web view to show them.
#[tauri::command]
async fn list_images(app: AppHandle, folder: String) -> CmdResult<Vec<String>> {
    let dir = PathBuf::from(&folder);
    allow_path(&app, &dir);
    let mut out: Vec<String> = fs::read_dir(&dir)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| matches!(e.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp"))
                .unwrap_or(false)
        })
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    out.sort();
    Ok(out)
}

#[tauri::command]
async fn allow_asset_path(app: AppHandle, path: String) -> CmdResult<()> {
    allow_path(&app, Path::new(&path));
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------------

#[tauri::command]
async fn log_error(state: State<'_, AppState>, message: String) -> CmdResult<()> {
    append_log(&state.data_dir, &message);
    Ok(())
}

#[tauri::command]
async fn data_dir_path(state: State<'_, AppState>) -> CmdResult<String> {
    Ok(state.data_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_data_dir(state: State<'_, AppState>) -> CmdResult<()> {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(&state.data_dir).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = &state;
    }
    Ok(())
}

/// "Delete all app data": library, playlists, settings, themes, copied backgrounds, crash log.
#[tauri::command]
async fn delete_all_data(state: State<'_, AppState>) -> CmdResult<()> {
    with_db(&state, |db| db.wipe())?;
    let _ = fs::remove_dir_all(backgrounds_dir(&state));
    let _ = fs::remove_file(log_path(&state.data_dir));
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------------------------

/// Portable mode: if a folder named `Glasklang-data` sits next to the .exe, keep everything there.
/// Otherwise use the normal per-user data folder (%LOCALAPPDATA%).
fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let portable = dir.join("Glasklang-data");
            if portable.is_dir() {
                return portable;
            }
        }
    }
    app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Glasklang", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &toggle, &prev, &next, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Glasklang")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => show_main_window(app),
            other => {
                // toggle / prev / next are handled by the web view, which owns playback.
                let _ = app.emit("tray-action", other.to_string());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = resolve_data_dir(&handle);
            fs::create_dir_all(&data_dir)?;

            // Any panic anywhere ends up in crash.log instead of vanishing.
            let hook_dir = data_dir.clone();
            std::panic::set_hook(Box::new(move |info| {
                append_log(&hook_dir, &format!("PANIC: {info}"));
            }));

            let db_path = data_dir.join("library.db");
            let db = Db::open(&db_path)?;

            // Let the web view read the data folder and every folder that holds library files.
            let scope = handle.asset_protocol_scope();
            let _ = scope.allow_directory(&data_dir, true);
            for folder in db.folders().unwrap_or_default() {
                let _ = scope.allow_directory(Path::new(&folder), true);
            }
            let parents: HashSet<PathBuf> = db
                .all_paths()
                .unwrap_or_default()
                .iter()
                .filter_map(|p| Path::new(p).parent().map(|x| x.to_path_buf()))
                .collect();
            for dir in parents {
                let _ = scope.allow_directory(&dir, false);
            }

            app.manage(AppState { db: Mutex::new(db), db_path, data_dir });

            // Real window blur: Mica on Windows 11, Acrylic as the Windows 10 fallback.
            #[cfg(windows)]
            {
                if let Some(w) = app.get_webview_window("main") {
                    use window_vibrancy::{apply_acrylic, apply_mica};
                    if apply_mica(&w, None).is_err() {
                        let _ = apply_acrylic(&w, Some((18, 18, 24, 140)));
                    }
                }
            }

            if let Err(e) = build_tray(&handle) {
                eprintln!("tray unavailable: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tracks,
            add_paths,
            rescan,
            list_folders,
            remove_folder,
            remove_tracks,
            restore_removed,
            get_cover,
            list_playlists,
            create_playlist,
            rename_playlist,
            delete_playlist,
            playlist_tracks,
            playlist_append,
            playlist_set,
            export_m3u,
            import_m3u,
            kv_get,
            kv_set,
            import_background,
            import_background_b64,
            file_to_base64,
            read_text_file,
            write_text_file,
            list_images,
            allow_asset_path,
            log_error,
            data_dir_path,
            open_data_dir,
            delete_all_data,
            yt::yt_status,
            yt::yt_install,
            yt::yt_update,
            yt::yt_search,
            yt::yt_fetch,
            yt::yt_clear_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glasklang");
}
