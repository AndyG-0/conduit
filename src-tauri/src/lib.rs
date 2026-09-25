mod app_config;
mod shortcuts;
mod webview;
mod window;

use std::sync::Mutex;

use app_config::Registry;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

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
            window::toggle_fullscreen,
            webview::launch_app,
            webview::return_to_grid,
            app_config::list_apps,
            app_config::create_app,
            app_config::update_app,
            app_config::delete_app,
        ])
        .setup(|app| {
            let registry = Registry::load(&app.handle().clone())?;
            app.manage(Mutex::new(registry));

            let main_window = app
                .get_webview_window("main")
                .expect("main window must exist");
            let app_handle = app.handle().clone();
            main_window.on_window_event(move |event| {
                if let WindowEvent::Resized(_) = event {
                    webview::sync_visible_app_windows(&app_handle);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
