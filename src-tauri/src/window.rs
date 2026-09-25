use tauri::{command, WebviewWindow};

/// Toggles the main window between normal windowed mode and fullscreen
/// "big-picture" mode. Returns the fullscreen state after toggling.
#[command]
pub fn toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    window
        .set_fullscreen(!is_fullscreen)
        .map_err(|e| e.to_string())?;
    Ok(!is_fullscreen)
}
