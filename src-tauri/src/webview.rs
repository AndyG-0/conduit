use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::app_config::{AppTile, NETFLIX};
use crate::shortcuts;

/// True if `url`'s host is one of `allowed`, or a subdomain of one of them.
/// Suffix-matched, not substring-matched, so `netflix.com.evil.tld` is
/// correctly rejected.
pub fn domain_allowed(url: &Url, allowed: &[&str]) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    allowed
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

/// Matches `app_window`'s on-screen position and size to `main_window`'s, so
/// it visually overlays the launcher grid as if it were the same window.
fn sync_window_geometry(
    main_window: &WebviewWindow,
    app_window: &WebviewWindow,
) -> tauri::Result<()> {
    app_window.set_position(main_window.outer_position()?)?;
    app_window.set_size(main_window.inner_size()?)?;
    Ok(())
}

fn launch_tile(
    main_window: &WebviewWindow,
    app: &AppHandle,
    tile: &'static AppTile,
) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(tile.id) {
        sync_window_geometry(main_window, &window)?;
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let url: Url = tile
        .base_url
        .parse()
        .unwrap_or_else(|e| panic!("tile {} has an invalid base_url: {e}", tile.id));
    let data_dir = app
        .path()
        .app_data_dir()?
        .join("partitions")
        .join(tile.partition);
    let scale_factor = main_window.scale_factor()?;
    let position = main_window
        .outer_position()?
        .to_logical::<f64>(scale_factor);
    let size = main_window.inner_size()?.to_logical::<f64>(scale_factor);

    WebviewWindowBuilder::new(app, tile.id, WebviewUrl::External(url))
        .data_directory(data_dir)
        .on_navigation(move |url| domain_allowed(url, tile.allowed_domains))
        .position(position.x, position.y)
        .inner_size(size.width, size.height)
        .decorations(false)
        .title(tile.name)
        .build()?;

    Ok(())
}

/// Opens (or re-shows) the Netflix window, hardcoded for this prototype —
/// see `app_config::NETFLIX`. Item 2 (settings app) replaces this with a
/// lookup against a real app registry.
#[command]
pub fn launch_app(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    launch_tile(&window, &app, &NETFLIX).map_err(|e| e.to_string())?;
    shortcuts::register(&app)
}

/// Hides the Netflix window (without destroying it, so playback position and
/// session state survive) and returns input focus to the launcher grid.
///
/// Netflix runs in its own top-level `WebviewWindow` rather than as a child
/// webview attached to the main window via Tauri's "unstable" `add_child`
/// API: `hide()`/`show()` on a real top-level window is the officially
/// supported path, and macOS tears down and rebuilds its whole compositing
/// surface on order-out/order-in.
///
/// Note for future debugging: `screencapture -x` on this machine has been
/// observed to return a stale, cached frame for a window that was just
/// hidden — confirmed via real interaction (`cliclick`) and frontmost-process
/// checks showing the window was genuinely hidden and non-interactive while
/// the screenshot still showed its last frame. Don't trust `screencapture`
/// alone to verify show/hide state; confirm with an interaction test instead.
pub fn return_to_grid_impl(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(NETFLIX.id) {
        window.hide()?;
    }

    if let Some(window) = app.get_webview_window("main") {
        window.set_focus()?;
    }

    Ok(())
}

/// JS-callable entry point for returning to the grid. The primary path is
/// the global back-to-grid shortcut (`shortcuts::register`'s handler), which
/// calls `return_to_grid_impl` directly; this command exists for any
/// programmatic/JS-triggered return.
#[command]
pub fn return_to_grid(app: AppHandle) -> Result<(), String> {
    return_to_grid_impl(&app).map_err(|e| e.to_string())?;
    shortcuts::unregister(&app)
}

/// Keeps the Netflix window's geometry matched to the main window's across
/// resizes (including entering/exiting fullscreen), so it keeps overlaying
/// the launcher grid. No-op while Netflix is hidden or hasn't been launched
/// yet.
pub fn sync_visible_app_windows(app: &AppHandle) {
    let (Some(main_window), Some(netflix_window)) = (
        app.get_webview_window("main"),
        app.get_webview_window(NETFLIX.id),
    ) else {
        return;
    };
    if netflix_window.is_visible().unwrap_or(false) {
        let _ = sync_window_geometry(&main_window, &netflix_window);
    }
}
