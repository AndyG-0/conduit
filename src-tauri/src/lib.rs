mod app_config;
mod shortcuts;
mod webview;
mod window;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            window::toggle_fullscreen,
            webview::launch_app,
            webview::return_to_grid,
        ])
        .setup(|app| {
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
