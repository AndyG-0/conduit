use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::menu::{HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::webview;
use crate::window;

/// Matches the app's long-standing in-page `Cmd+Enter` binding
/// (`main.ts`'s `keydown` listener, which calls `toggle_fullscreen`
/// directly). That listener only fires while the grid page itself has
/// keyboard focus — once a tile's embedded webview is focused (i.e.
/// almost the entire time a tile is playing), it never sees the
/// keypress. A menu item's accelerator is dispatched by AppKit as a key
/// equivalent whenever Conduit is frontmost, regardless of which child
/// webview currently holds first responder, so this restores fullscreen
/// toggling while a tile is active without registering a true
/// `tauri_plugin_global_shortcut` hotkey — `Cmd+Enter` is common enough
/// in other apps that hijacking it system-wide (like `shortcuts.rs`
/// deliberately avoids doing for plain `Cmd+R`) would be too invasive.
const FULLSCREEN_ACCELERATOR: &str = "CmdOrCtrl+Enter";

/// Same accelerator string as `shortcuts::REFRESH_SHORTCUT` — both trigger
/// the same underlying action, so there's no behavior divergence between
/// the menu item and the global hotkey.
const REFRESH_ACCELERATOR: &str = "CmdOrCtrl+Shift+R";

/// Same accelerator string as `shortcuts::TOGGLE_PIP_SHORTCUT`, for the same
/// reason as `REFRESH_ACCELERATOR`.
const TOGGLE_PIP_ACCELERATOR: &str = "CmdOrCtrl+Shift+P";

/// Accelerators for the Back/Forward/Home navigation items. Menu-only (no
/// matching `shortcuts.rs` global hotkey) — unlike Refresh/PiP, these aren't
/// the only way to recover from a stuck tile, so there's no need to make
/// them reachable while some other app is frontmost.
const BACK_ACCELERATOR: &str = "CmdOrCtrl+[";
const FORWARD_ACCELERATOR: &str = "CmdOrCtrl+]";
/// "Home" means "back to the tile grid" (same destination as
/// `shortcuts::BACK_TO_GRID_SHORTCUT`/Cmd+Shift+Escape) — matching what a
/// remote's actual Home button does, not a browser's home-page button. See
/// `"site_home"` for the latter.
const HOME_ACCELERATOR: &str = "CmdOrCtrl+Shift+H";

/// Toggles DevTools for whichever webview is showing. Only registered in
/// debug builds — `Webview::open_devtools`/`close_devtools` are themselves
/// gated `#[cfg(any(debug_assertions, feature = "devtools"))]` upstream, and
/// this app intentionally doesn't enable the `devtools` Cargo feature, so a
/// release build wouldn't have anything to call here anyway.
#[cfg(debug_assertions)]
const TOGGLE_DEVTOOLS_ACCELERATOR: &str = "CmdOrCtrl+Alt+I";

/// AppKit automatically inserts its own "Enter Full Screen" item
/// (Control-Command-F) into the app menu for any window whose
/// `collectionBehavior` supports fullscreen — which ours must, since
/// `toggle_fullscreen_impl` (via tao's `set_fullscreen`) drives fullscreen
/// through the exact same native `toggleFullScreen:` action. Left alone,
/// that gives two menu items that do the same thing: this one and
/// `fullscreen_item` below. Setting this default is the documented way to
/// suppress AppKit's automatic item without giving up native fullscreen
/// support itself, so `fullscreen_item`'s Cmd+Enter binding (needed while a
/// tile webview holds focus — see its doc comment) stays the only entry.
#[cfg(target_os = "macos")]
fn disable_automatic_fullscreen_menu_item() {
    use objc2_foundation::{ns_string, NSUserDefaults};
    NSUserDefaults::standardUserDefaults()
        .setBool_forKey(false, ns_string!("NSFullScreenMenuItemEverywhere"));
}

/// Installs a native menu equivalent to Tauri's own default
/// (`Menu::default`), plus a "Refresh" item in the View submenu — the macOS
/// app-menu layout there, a File/Edit/View/Window/Help menubar on Windows. Tauri's
/// default menu isn't addressable by submenu ID after the fact, so this
/// rebuilds the same structure explicitly rather than mutating it in place.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    disable_automatic_fullscreen_menu_item();

    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        icon: app.default_window_icon().cloned(),
        ..Default::default()
    };

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let open_help_item = MenuItem::with_id(app, "open_help", "Conduit Help", true, None::<&str>)?;

    let fullscreen_item = MenuItem::with_id(
        app,
        "toggle_fullscreen",
        "Toggle Full Screen",
        true,
        Some(FULLSCREEN_ACCELERATOR),
    )?;
    let refresh_item =
        MenuItem::with_id(app, "refresh", "Refresh", true, Some(REFRESH_ACCELERATOR))?;
    let pip_item = MenuItem::with_id(
        app,
        "toggle_pip",
        "Picture in Picture",
        true,
        Some(TOGGLE_PIP_ACCELERATOR),
    )?;
    let back_item = MenuItem::with_id(app, "back", "Back", true, Some(BACK_ACCELERATOR))?;
    let forward_item =
        MenuItem::with_id(app, "forward", "Forward", true, Some(FORWARD_ACCELERATOR))?;
    let home_item = MenuItem::with_id(app, "home", "Home", true, Some(HOME_ACCELERATOR))?;
    let site_home_item = MenuItem::with_id(app, "site_home", "Site Home", true, None::<&str>)?;
    #[cfg(debug_assertions)]
    let devtools_item = MenuItem::with_id(
        app,
        "toggle_devtools",
        "Toggle Developer Tools",
        true,
        Some(TOGGLE_DEVTOOLS_ACCELERATOR),
    )?;

    // Window-mode controls, then tile navigation, then (debug builds only)
    // developer tools — grouped with separators rather than one flat list.
    let nav_separator = PredefinedMenuItem::separator(app)?;
    #[cfg(debug_assertions)]
    let devtools_separator = PredefinedMenuItem::separator(app)?;
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
    let mut view_items: Vec<&dyn IsMenuItem<Wry>> = vec![
        &fullscreen_item,
        &pip_item,
        &nav_separator,
        &back_item,
        &forward_item,
        &refresh_item,
        &home_item,
        &site_home_item,
    ];
    #[cfg(debug_assertions)]
    {
        view_items.push(&devtools_separator);
        view_items.push(&devtools_item);
    }

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(app, "View", true, &view_items)?;

    #[cfg(not(windows))]
    {
        let help_menu =
            Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[&open_help_item])?;
        let menu = Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    pkg_info.name.clone(),
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, None)?,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[&PredefinedMenuItem::close_window(app, None)?],
                )?,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        )?;
        app.set_menu(menu)?;
    }

    // Windows has no app-wide menu bar — a menu is a per-window menubar
    // drawn inside the window itself. Windows conventions put Exit under File
    // and About under Help (there's no app submenu to hold them), and
    // Services/Hide/Hide Others are macOS-only concepts muda doesn't
    // implement there. Attached to "main" only rather than via
    // `app.set_menu`, which on Windows would also give the undecorated PiP
    // window and SSO popups a menubar of their own. `window::
    // toggle_fullscreen_impl` hides it while fullscreen, matching how
    // macOS's menu bar gets out of the way.
    #[cfg(windows)]
    {
        let help_menu = Submenu::with_id_and_items(
            app,
            HELP_SUBMENU_ID,
            "Help",
            true,
            &[
                &open_help_item,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::about(app, Some("About Conduit"), Some(about_metadata))?,
            ],
        )?;
        let menu = Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[&PredefinedMenuItem::quit(app, Some("Exit"))?],
                )?,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        )?;
        if let Some(main_window) = app.get_window("main") {
            main_window.set_menu(menu)?;
        }
    }

    app.on_menu_event(|app, event| {
        if event.id() == "toggle_fullscreen" {
            let _ = window::toggle_fullscreen_impl(app);
        } else if event.id() == "refresh" {
            let _ = webview::refresh_active_tile(app.clone());
        } else if event.id() == "toggle_pip" {
            // Entering PiP creates a window and a webview, which deadlocks on
            // Windows if done synchronously on this thread (wry issue #583) —
            // same thread-hop `shortcuts.rs`'s `TOGGLE_PIP_SHORTCUT` handler
            // uses, applied here too for consistency/defense-in-depth.
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = app.clone().run_on_main_thread(move || {
                    if let Err(e) = webview::toggle_pip(&app) {
                        eprintln!("toggle_pip error: {e}");
                    }
                });
            });
        } else if event.id() == "back" {
            let _ = webview::navigate_active_tile_back(app.clone());
        } else if event.id() == "forward" {
            let _ = webview::navigate_active_tile_forward(app.clone());
        } else if event.id() == "home" {
            let _ = webview::return_to_grid(app.clone());
            // Also closes Settings/Help in the launcher page (see the
            // `return-to-grid` listener in `main.ts`) — `return_to_grid`
            // itself only knows about tile webviews.
            let _ = app.emit("return-to-grid", ());
        } else if event.id() == "site_home" {
            let _ = webview::navigate_active_tile_home(app.clone());
        } else if event.id() == "open_help" {
            let _ = app.emit("open-help", ());
        } else if cfg!(debug_assertions) && event.id() == "toggle_devtools" {
            #[cfg(debug_assertions)]
            {
                let target = webview::visible_tile_webview(app).or_else(|| app.get_webview("main"));
                if let Some(webview) = target {
                    if webview.is_devtools_open() {
                        webview.close_devtools();
                    } else {
                        webview.open_devtools();
                    }
                }
            }
        }
    });

    Ok(())
}
