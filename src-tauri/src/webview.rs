use tauri::{command, AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::app_config::{AppTile, RegistryState};
use crate::shortcuts;

/// Identity/SSO hosts allowed across every tile, in addition to each tile's
/// own `allowed_domains`. Login flows for several services (Hulu/Disney+/
/// ESPN's shared Disney identity, YouTube TV's Google login, Tubi's
/// Facebook/Apple sign-in) redirect through one of these. Cable-provider
/// "TV Everywhere" logins redirect through too many variable third-party
/// domains to hardcode here — a user hitting one of those can add the
/// specific domain to that tile's allowed list through Settings.
pub const COMMON_SSO_DOMAINS: &[&str] = &[
    "accounts.google.com",
    "appleid.apple.com",
    "login.live.com",
    "facebook.com",
];

/// True if `url`'s host is one of `allowed` (or `COMMON_SSO_DOMAINS`), or a
/// subdomain of one of them. Suffix-matched, not substring-matched, so
/// `netflix.com.evil.tld` is correctly rejected.
pub fn domain_allowed(url: &Url, allowed: &[String]) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let matches = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    allowed.iter().any(|d| matches(d)) || COMMON_SSO_DOMAINS.iter().any(|d| matches(d))
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

fn launch_tile(main_window: &WebviewWindow, app: &AppHandle, tile: &AppTile) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(&tile.id) {
        sync_window_geometry(main_window, &window)?;
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let url: Url = tile
        .base_url
        .parse()
        .unwrap_or_else(|e| panic!("tile {} has an invalid base_url: {e}", tile.id));
    let data_dir = app.path().app_data_dir()?.join("partitions").join(&tile.id);
    let scale_factor = main_window.scale_factor()?;
    let position = main_window
        .outer_position()?
        .to_logical::<f64>(scale_factor);
    let size = main_window.inner_size()?.to_logical::<f64>(scale_factor);
    let allowed_domains = tile.allowed_domains.clone();

    WebviewWindowBuilder::new(app, &tile.id, WebviewUrl::External(url))
        .data_directory(data_dir)
        .on_navigation(move |url| domain_allowed(url, &allowed_domains))
        .position(position.x, position.y)
        .inner_size(size.width, size.height)
        .decorations(false)
        .title(&tile.name)
        .build()?;

    Ok(())
}

/// Opens (or re-shows) the named tile's window, looked up from the app
/// registry.
#[command]
pub fn launch_app(
    window: WebviewWindow,
    app: AppHandle,
    registry: State<RegistryState>,
    id: String,
) -> Result<(), String> {
    let tile = registry
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no tile with id {id}"))?;
    launch_tile(&window, &app, &tile).map_err(|e| e.to_string())?;
    shortcuts::register(&app)
}

/// Closes (destroys) a tile's window if it's currently open. Used when a
/// tile is deleted from the registry, unlike `return_to_grid_impl` which
/// only hides a window so playback/session state survives.
pub fn close_tile_window(app: &AppHandle, id: &str) {
    if let Some(window) = app.get_webview_window(id) {
        let _ = window.close();
    }
}

/// Hides whichever app window is currently visible (without destroying it,
/// so playback position and session state survive) and returns input focus
/// to the launcher grid.
///
/// Each tile runs in its own top-level `WebviewWindow` rather than as a
/// child webview attached to the main window via Tauri's "unstable"
/// `add_child` API: `hide()`/`show()` on a real top-level window is the
/// officially supported path, and macOS tears down and rebuilds its whole
/// compositing surface on order-out/order-in.
///
/// Note for future debugging: `screencapture -x` on this machine has been
/// observed to return a stale, cached frame for a window that was just
/// hidden — confirmed via real interaction (`cliclick`) and frontmost-process
/// checks showing the window was genuinely hidden and non-interactive while
/// the screenshot still showed its last frame. Don't trust `screencapture`
/// alone to verify show/hide state; confirm with an interaction test instead.
pub fn return_to_grid_impl(app: &AppHandle) -> tauri::Result<()> {
    for (label, window) in app.webview_windows() {
        if label != "main" && window.is_visible().unwrap_or(false) {
            window.hide()?;
        }
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

/// Keeps whichever app window is currently visible matched to the main
/// window's geometry across resizes (including entering/exiting
/// fullscreen), so it keeps overlaying the launcher grid. No-op while no
/// app window is visible.
pub fn sync_visible_app_windows(app: &AppHandle) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    for (label, window) in app.webview_windows() {
        if label != "main" && window.is_visible().unwrap_or(false) {
            let _ = sync_window_geometry(&main_window, &window);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn domains(list: &[&str]) -> Vec<String> {
        list.iter().map(|d| d.to_string()).collect()
    }

    #[test]
    fn allows_exact_and_subdomain_matches() {
        let allowed = domains(&["netflix.com"]);
        assert!(domain_allowed(
            &Url::parse("https://netflix.com/").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://www.netflix.com/").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://api.netflix.com/x").unwrap(),
            &allowed
        ));
    }

    #[test]
    fn rejects_suffix_confusion_and_unrelated_domains() {
        let allowed = domains(&["netflix.com"]);
        assert!(!domain_allowed(
            &Url::parse("https://netflix.com.evil.tld/").unwrap(),
            &allowed
        ));
        assert!(!domain_allowed(
            &Url::parse("https://hulu.com/").unwrap(),
            &allowed
        ));
    }

    #[test]
    fn allows_common_sso_domains_regardless_of_tile() {
        let allowed = domains(&["netflix.com"]);
        assert!(domain_allowed(
            &Url::parse("https://accounts.google.com/signin").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://appleid.apple.com/auth").unwrap(),
            &allowed
        ));
    }

    #[test]
    fn a_tiles_own_domains_do_not_leak_to_another_tile() {
        let hulu_allowed = domains(&["hulu.com", "disney.com"]);
        assert!(!domain_allowed(
            &Url::parse("https://www.netflix.com/").unwrap(),
            &hulu_allowed
        ));
    }
}
