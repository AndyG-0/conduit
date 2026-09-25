use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::webview;

/// The key combo that returns focus to the launcher grid while the Netflix
/// webview is focused. Deliberately not plain `Escape` — macOS fullscreen
/// video players commonly bind that to exit-fullscreen.
pub const BACK_TO_GRID_SHORTCUT: &str = "CmdOrCtrl+Shift+Escape";

/// Registers the back-to-grid shortcut as an OS-global hotkey. Must be
/// called only while the Netflix webview is visible: it's a separate native
/// webview with its own JS context, so a `keydown` listener in the
/// launcher page's JS never sees key events delivered to it. Registering
/// this for the app's whole lifetime would make it a global hotkey even
/// while the user is just looking at the grid, so callers must pair this
/// with `unregister` when returning to the grid.
pub fn register(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(BACK_TO_GRID_SHORTCUT, |app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            // tauri-plugin-global-shortcut invokes this callback while holding
            // the lock its own `unregister` needs, so calling `unregister`
            // synchronously here deadlocks the whole app (confirmed via a
            // `sample` stack trace showing the main thread stuck in
            // `pthread_mutex_firstfit_lock_wait` inside this exact path).
            // `AppHandle::run_on_main_thread` only defers to a later event-loop
            // tick when called from a *different* thread — this hotkey handler
            // already runs on the main thread, so calling it directly here just
            // re-enters the same call stack (and the same lock) synchronously,
            // confirmed by a second `sample` showing the exact same hang with
            // `run_on_main_thread` nested directly under the hotkey dispatch
            // frame that holds the lock. Hopping onto a plain thread first
            // forces the genuinely-deferred path.
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = app.clone().run_on_main_thread(move || {
                    let _ = webview::return_to_grid_impl(&app);
                    let _ = unregister(&app);
                    let _ = app.emit("return-to-grid", ());
                });
            });
        })
        .map_err(|e| e.to_string())
}

/// Unregisters the back-to-grid shortcut. Safe to call even if it isn't
/// currently registered.
pub fn unregister(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister(BACK_TO_GRID_SHORTCUT)
        .map_err(|e| e.to_string())
}
