use std::str::FromStr;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::webview;

/// The key combo that returns focus to the launcher grid while the Netflix
/// webview is focused. Deliberately not plain `Escape` — macOS fullscreen
/// video players commonly bind that to exit-fullscreen.
///
/// Windows gets a different combo: `Ctrl+Shift+Escape` (what `CmdOrCtrl`
/// would resolve to) is reserved by Windows itself to open Task Manager, so
/// `RegisterHotKey` can never claim it.
#[cfg(not(windows))]
pub const BACK_TO_GRID_SHORTCUT: &str = "CmdOrCtrl+Shift+Escape";
#[cfg(windows)]
pub const BACK_TO_GRID_SHORTCUT: &str = "Ctrl+Shift+Backspace";

/// Reloads the active tile — e.g. to recover from a dropped connection.
/// Deliberately not plain `Cmd+R`: this has to be a true OS-global hotkey
/// (tile windows run no Conduit JS to scope a local listener to), and plain
/// `Cmd+R` would hijack refresh in whatever app is frontmost any time a tile
/// window is merely open in the background. Shares its accelerator string
/// with the "Refresh" menu item in `menu.rs`.
pub const REFRESH_SHORTCUT: &str = "CmdOrCtrl+Shift+R";

/// Toggles picture-in-picture for the active tile.
pub const TOGGLE_PIP_SHORTCUT: &str = "CmdOrCtrl+Shift+P";

/// Registers all tile-scoped global hotkeys under one shared handler. Must
/// be called only while the Netflix webview is visible: it's a separate
/// native webview with its own JS context, so a `keydown` listener in the
/// launcher page's JS never sees key events delivered to it. Registering
/// these for the app's whole lifetime would make them global hotkeys even
/// while the user is just looking at the grid, so callers must pair this
/// with `unregister` when returning to the grid.
pub fn register(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcuts(
            [BACK_TO_GRID_SHORTCUT, REFRESH_SHORTCUT, TOGGLE_PIP_SHORTCUT],
            |app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }

                if *shortcut == Shortcut::from_str(BACK_TO_GRID_SHORTCUT).unwrap() {
                    // tauri-plugin-global-shortcut invokes this callback while
                    // holding the lock its own `unregister` needs, so calling
                    // `unregister` synchronously here deadlocks the whole app
                    // (confirmed via a `sample` stack trace showing the main
                    // thread stuck in `pthread_mutex_firstfit_lock_wait` inside
                    // this exact path). `AppHandle::run_on_main_thread` only
                    // defers to a later event-loop tick when called from a
                    // *different* thread — this hotkey handler already runs on
                    // the main thread, so calling it directly here just
                    // re-enters the same call stack (and the same lock)
                    // synchronously, confirmed by a second `sample` showing the
                    // exact same hang with `run_on_main_thread` nested directly
                    // under the hotkey dispatch frame that holds the lock.
                    // Hopping onto a plain thread first forces the
                    // genuinely-deferred path.
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = app.clone().run_on_main_thread(move || {
                            // PiP-aware: closing the "pip" window (rather than
                            // running the normal return-to-grid logic) is
                            // enough on its own — its own `CloseRequested`
                            // handler (see `enter_pip` in webview.rs) puts the
                            // tile back in the main window, and `unregister`
                            // still needs to run either way since these
                            // shortcuts are scoped to "a tile is showing
                            // somewhere", not to which window it's in.
                            if let Some(pip_window) = app.get_window("pip") {
                                let _ = pip_window.close();
                            } else {
                                let _ = webview::return_to_grid_impl(&app);
                            }
                            let _ = unregister(&app);
                            let _ = app.emit("return-to-grid", ());
                        });
                    });
                } else if *shortcut == Shortcut::from_str(REFRESH_SHORTCUT).unwrap() {
                    // Doesn't create a window, so it can run synchronously
                    // on this thread without the deadlock above.
                    if let Some(webview) = webview::visible_tile_webview(app) {
                        let _ = webview.reload();
                    }
                } else if *shortcut == Shortcut::from_str(TOGGLE_PIP_SHORTCUT).unwrap() {
                    // Entering PiP creates a window and a webview, which
                    // deadlocks on Windows if done synchronously on this
                    // thread (wry issue #583) — same thread-hop
                    // BACK_TO_GRID_SHORTCUT above uses.
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = app.clone().run_on_main_thread(move || {
                            if let Err(e) = webview::toggle_pip(&app) {
                                eprintln!("toggle_pip error: {e}");
                            }
                        });
                    });
                }
            },
        )
        .map_err(|e| e.to_string())
}

/// Unregisters all tile-scoped global hotkeys. Safe to call even if they
/// aren't currently registered.
pub fn unregister(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_multiple([BACK_TO_GRID_SHORTCUT, REFRESH_SHORTCUT, TOGGLE_PIP_SHORTCUT])
        .map_err(|e| e.to_string())
}
