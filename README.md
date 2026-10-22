# Glasklang

A fast, private music player for Windows with a **liquid glass** look and backgrounds you choose yourself.
Single portable `Glasklang.exe`. No installer, no admin rights, no account, no internet.

> *Glasklang* is Swedish: *glas* (glass) + *klang* (resonant sound). *Glasklar* means "crystal clear".

## Features

**Playback**
- MP3 (required), plus FLAC, WAV, OGG/Opus, AAC and M4A (whatever the Windows web view can decode)
- Near-gapless track changes (next song is preloaded, see [Known limits](#known-limits))
- Queue, shuffle, repeat (off / all / one), seek bar, volume, playback speed, 5-band equalizer
- Remembers your last queue, song and position, and the window size and place

**Library**
- Drag & drop files or folders into the window, or use **Add music folder**
- Songs, albums, artists and playlists, plus instant search
- Smooth with 50,000+ songs: virtualized lists and an indexed local SQLite database; rescans skip unchanged files
- Reads ID3/Vorbis/MP4 tags and embedded cover art (falls back to `cover.jpg`/`folder.jpg` in the folder, then to the file name)
- Playlists: create, rename, reorder (arrow buttons), remove, import and export `.m3u` / `.m3u8`

**Liquid glass look**
- Frosted, translucent panels with soft edge highlights, rounded corners and springy animations
- Windows 11 Mica / Windows 10 Acrylic behind the window
- Optional *Refraction (experimental)* mode that bends the background near panel edges
- Light, dark and auto theme, follows the Windows accent color, album art can tint the accent, respects "reduce motion"

**Your own background**
- Image (JPG / PNG / WebP), animated GIF, muted looping video (MP4 / WebM), solid color, gradient, folder slideshow, or the current album art
- Blur, brightness, tint color and strength, fit/fill/stretch, glass blur / saturation / intensity
- Auto contrast keeps text readable on bright or dark backgrounds
- Save looks as named themes; export / import a theme as one `.json` file (the background image is embedded, up to 40 MB)

**Windows integration**
- Media keys and the Windows media overlay (via the browser Media Session API), optional "force media keys" setting
- System tray icon with Play/Pause, Next, Previous; optional "hide to tray when closing"
- Mini player: small always-on-top window
- Pauses when headphones are unplugged

**Private and robust**
- Works fully offline; see [Privacy](#privacy)
- Corrupt, missing or moved files never crash the app: they are skipped with a message, and logged to a local `crash.log`
- If a drive is unplugged, its songs stay in the library instead of being deleted

## Download and run

1. Open the **Releases** page of this repository and download `Glasklang.exe` (or the `.zip`).
2. Double-click it. That's it.

**Windows SmartScreen:** because the program is not code-signed (certificates cost money), Windows may show
"Windows protected your PC". Click **More info**, then **Run anyway**. You can compare the file with
`SHA256SUMS.txt` from the release, or build it yourself (below).

Requires Windows 10 or 11 (64-bit). It uses WebView2, which is already part of Windows 11 and updated Windows 10.

**Where is my data?** In `%LOCALAPPDATA%\se.glasklang.player` (Settings -> Library -> *Open data folder*).
For a fully portable setup, create a folder named `Glasklang-data` next to `Glasklang.exe` and everything is stored there.
Settings -> Library -> *Delete all app data* wipes the library, settings, themes, copied backgrounds and the crash log.

## Using it

| Do this | To get this |
|---|---|
| Drag files/folders onto the window | Add music |
| Double-click a song | Play it (the list becomes your queue) |
| `+` on a song | Play next |
| list-plus on a song | Add to a playlist |
| `Space` | Play / pause |
| `Ctrl+F` | Search |
| Sliders icon (top right) | Look, background, audio, library, privacy |
| Mini-player icon | Small always-on-top player |

## Build it yourself

### Easiest: let GitHub build it (nothing to install)

1. Create a new repository on GitHub and upload this folder (with GitHub Desktop, or `git init`, `git add .`, `git commit`, `git push`).
2. Create a release tag. In a terminal inside the folder:
   ```
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. Open the **Actions** tab. When *Release (build Glasklang.exe)* is green, the **Releases** page has `Glasklang.exe`.
   (You can also start the workflow by hand from the Actions tab; then the exe is under *Artifacts*.)

### On your own PC

Install [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs) (with the "Desktop development with C++" build tools) and then:

```
npm install
npm run tauri dev                      # run with live reload
npm run tauri -- build --no-bundle     # build -> target\release\glasklang.exe
cargo test -p glasklang-core           # unit tests for scanner, tags, library, playlists, M3U
```

If you change the icon, replace `src-tauri/icons/icon.png` and run `npm run tauri -- icon src-tauri/icons/icon.png`.

## Architecture (short)

```
glasklang/
  core/                 Rust library with no window code, so it is easy to test anywhere
    db.rs               SQLite: tracks, folders, playlists, key/value settings
    scanner.rs          folder walk, skip unchanged files, prune only files that are really gone
    tags.rs             tags + cover art via `lofty`, with safe fallbacks
    m3u.rs              playlist import/export
  src-tauri/            Tauri 2 shell (Rust): commands, tray, Mica/Acrylic, crash log, asset scope
  src/                  React + TypeScript UI
    lib/audio.ts        two-slot player + Web Audio EQ
    lib/store.ts        app state, queue, shuffle, media session, settings
    components/         glass UI, virtualized lists, settings, backgrounds
  .github/workflows/    release.yml builds the exe, ci.yml runs tests
```

Why these choices:
- **Tauri 2 + web UI**: CSS `backdrop-filter` and SVG filters make liquid glass much easier than native Windows UI, backgrounds (images, GIF, video) work out of the box, and the exe is small and starts fast.
- **Browser audio engine** (`<audio>` + Web Audio): MP3/FLAC/etc. decoding is built into WebView2, so no audio library is needed and playback runs outside the UI thread.
- **Rust for everything with files**: tags, folder scanning and SQLite are fast and run off the UI thread, so scrolling and animation never stall the music.
- **Lists in the UI, library in SQLite**: the app loads the compact track list once, then search, sort and grouping run in memory (milliseconds for 50,000 songs).
- **Extending**: a visualizer would hang an `AnalyserNode` off the master gain in `audio.ts`; lyrics or plugins can read `Track` objects from the store.

## Privacy

- No network code: there is no HTTP client in the dependency list.
- The window's Content-Security-Policy (`src-tauri/tauri.conf.json`) only allows local resources; no outbound requests are possible from the UI.
- Tauri permissions (`src-tauri/capabilities/default.json`) grant no network, shell or broad file access. The web view can only read files that you added (library folders) or that the app copied into its own data folder.
- No telemetry, analytics, accounts, update checks, online cover art or lyrics.
- All data is local; `crash.log` stays on your PC.

## Known limits

- **Near-gapless, not bit-perfect gapless.** The next track is preloaded and started a few milliseconds before the current one ends. Browsers do not trim MP3 encoder padding, so albums mixed to flow seamlessly can have a tiny gap.
- **True lens refraction** is not possible with CSS alone. *Refraction (experimental)* bends the backdrop near edges with an SVG filter; it costs more GPU, so frosted is the default.
- **Acrylic on Windows 10** can feel laggy while dragging the window on some builds; Mica on Windows 11 is smooth.
- **Reordering** uses arrow buttons: Windows web views disable in-page drag-and-drop when file drops from Explorer are enabled.
- **WMA** is scanned but may not play (the web view decides).
- **Media keys** normally work through the Windows media overlay. If yours don't, turn on *Settings -> Audio -> Force media keys*.

## Third-party software and licenses

| Component | License |
|---|---|
| [Tauri](https://tauri.app) 2 and its plugins (dialog, global-shortcut, window-state) | MIT / Apache-2.0 |
| [lofty](https://crates.io/crates/lofty) (tags) | MIT / Apache-2.0 |
| [rusqlite](https://crates.io/crates/rusqlite) | MIT |
| [SQLite](https://sqlite.org) (bundled) | Public domain |
| [walkdir](https://crates.io/crates/walkdir) | MIT / Unlicense |
| [window-vibrancy](https://crates.io/crates/window-vibrancy) | MIT / Apache-2.0 |
| anyhow, serde, base64, tempfile (tests) | MIT / Apache-2.0 |
| [React](https://react.dev) 19 | MIT |
| [zustand](https://github.com/pmndrs/zustand) | MIT |
| [@tanstack/react-virtual](https://tanstack.com/virtual) | MIT |
| Vite, @vitejs/plugin-react | MIT |
| TypeScript | Apache-2.0 |

Run `cargo tree` and `npm ls` for the complete transitive list. Glasklang itself is MIT licensed (see `LICENSE`).
