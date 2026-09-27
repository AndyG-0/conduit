use tauri::{command, AppHandle, Manager};

use crate::webview;

/// Toggles the main window between normal windowed mode and fullscreen.
/// Returns the fullscreen state after toggling.
///
/// Looks up the main window by label rather than taking a `Window`/
/// `WebviewWindow` command argument: once "main" hosts a child tile
/// webview, `WebviewWindow`'s `is_webview_window()` check permanently
/// fails for it, and this is also called from `menu.rs`'s event handler,
/// which has no command-argument injection to rely on.
pub fn toggle_fullscreen_impl(app: &AppHandle) -> tauri::Result<bool> {
    let window = app.get_window("main").ok_or(tauri::Error::WindowNotFound)?;
    let is_fullscreen = window.is_fullscreen()?;
    window.set_fullscreen(!is_fullscreen)?;
    // auto_resize would eventually resync the active tile's bounds on its
    // own via the Resized event this also triggers, but that's gated on
    // macOS's fullscreen animation finishing — do it immediately instead.
    webview::sync_active_tile_bounds(app)?;
    Ok(!is_fullscreen)
}

#[command]
pub fn toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    toggle_fullscreen_impl(&app).map_err(|e| e.to_string())
}

/// Whether the main window is currently fullscreen. Used by the screensaver's
/// idle timer (`screensaver.rs`), which is only ever supposed to arm while
/// fullscreen.
#[command]
pub fn is_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_window("main")
        .ok_or(tauri::Error::WindowNotFound)
        .map_err(|e| e.to_string())?;
    window.is_fullscreen().map_err(|e| e.to_string())
}
