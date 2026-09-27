mod app_config;
mod favicon;
mod jellyfin;
mod menu;
mod preferences;
mod screensaver;
mod secrets;
mod shortcuts;
mod trending;
mod webview;
mod window;

use std::sync::Mutex;

use app_config::Registry;
use preferences::Preferences;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

// TEMPORARY — diagnosing the edit-mode drag-release issue by piping frontend
// event traces to a fixed file, since there's no way to read the webview's
// own devtools console remotely and stdout isn't reliably capturable
// regardless of how the dev server was launched. Remove once the drag bug is
// fixed.
#[tauri::command]
fn debug_log(msg: String) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/conduit-debug.log")
    {
        let _ = writeln!(f, "[js-debug] {msg}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        // Scaffold only: `pubkey`/`endpoints` in tauri.conf.json are
        // placeholders, so `check()` will fail against them today. See
        // TODO.md item 11 for the manual steps left to make this real.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            debug_log,
            window::toggle_fullscreen,
            webview::launch_app,
            webview::return_to_grid,
            webview::refresh_active_tile,
            webview::toggle_pip_command,
            webview::report_native_pip_unavailable,
            webview::navigate_active_tile_back,
            webview::navigate_active_tile_forward,
            webview::navigate_active_tile_home,
            webview::list_blocked_domains,
            webview::dismiss_blocked_domain,
            webview::close_tile_popups,
            webview::report_tile_activity,
            window::is_fullscreen,
            app_config::list_apps,
            app_config::create_app,
            app_config::update_app,
            app_config::delete_app,
            app_config::reorder_apps,
            favicon::fetch_favicon,
            jellyfin::fetch_jellyfin_banner,
            jellyfin::set_jellyfin_api_key,
            preferences::get_preferences,
            preferences::set_screensaver_enabled,
            preferences::set_theme,
            preferences::set_tmdb_api_key,
            screensaver::fetch_aerial_catalog,
            screensaver::enter_screensaver,
            screensaver::exit_screensaver,
            trending::fetch_trending_catalog,
        ])
        .setup(|app| {
            let registry = Registry::load(&app.handle().clone())?;
            app.manage(Mutex::new(registry));
            app.manage(webview::ActiveTileState::default());
            app.manage(webview::BlockedDomainsState::default());

            let preferences = Preferences::load(&app.handle().clone())?;
            app.manage(Mutex::new(preferences));
            app.manage(screensaver::ScreensaverState::default());

            menu::install(&app.handle().clone())?;

            // The fallback PiP window (see `webview::enter_pip_fallback`) is
            // a separate top-level window, so closing "main" doesn't close
            // it on its own — do that explicitly rather than leaving it
            // behind as an orphaned window once the rest of the app is gone.
            if let Some(main_window) = app.get_window("main") {
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::CloseRequested { .. }) {
                        if let Some(pip_window) = app_handle.get_window("pip") {
                            let _ = pip_window.close();
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
