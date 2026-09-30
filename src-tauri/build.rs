/// Every command in `lib.rs`'s `generate_handler!` — keep the two in sync.
/// Declaring an app manifest makes Tauri check every app command against
/// the capabilities (not just remote-origin ones), so a command missing here
/// has no `allow-*` permission and is rejected for the launcher too.
const COMMANDS: &[&str] = &[
    "debug_log",
    "toggle_fullscreen",
    "launch_app",
    "return_to_grid",
    "refresh_active_tile",
    "toggle_pip_command",
    "report_native_pip_unavailable",
    "navigate_active_tile_back",
    "navigate_active_tile_forward",
    "navigate_active_tile_home",
    "list_blocked_domains",
    "dismiss_blocked_domain",
    "close_tile_popups",
    "report_tile_activity",
    "is_fullscreen",
    "list_apps",
    "create_app",
    "update_app",
    "delete_app",
    "reorder_apps",
    "fetch_favicon",
    "fetch_jellyfin_banner",
    "set_jellyfin_api_key",
    "get_preferences",
    "set_screensaver_enabled",
    "set_theme",
    "set_tmdb_api_key",
    "fetch_aerial_catalog",
    "enter_screensaver",
    "exit_screensaver",
    "fetch_trending_catalog",
];

fn main() {
    // tauri-build normally embeds its Windows app manifest (which opts into
    // Common Controls v6) as a resource on the app binary only. Test binaries
    // then link against comctl32 v5, which lacks `TaskDialogIndirect`, and die
    // at startup with STATUS_ENTRYPOINT_NOT_FOUND before a single test runs.
    // Embedding the same manifest (`windows-app-manifest.xml`, copied verbatim
    // from tauri-build) through the linker instead covers every target,
    // tests included; tauri-build's own copy is turned off so the app binary
    // doesn't end up with two.
    // The app manifest lets `capabilities/tile-remote.json` grant the
    // streaming sites' pages exactly two commands (see `permissions/`) while
    // everything else stays launcher-only.
    println!("cargo:rerun-if-changed=permissions");
    let mut attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
