//! Glasklang core: everything that does not need a window.
//! Kept free of any Tauri dependency so it can be unit-tested anywhere.

pub mod db;
pub mod m3u;
pub mod scanner;
pub mod tags;
