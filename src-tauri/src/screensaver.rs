use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};

use crate::webview;

/// Apple's own Aerial-screensaver catalog endpoint — the same source the
/// open-source `JohnCoates/Aerial` macOS screensaver project uses. Kept as a
/// plain constant (no user-facing configuration) since it's Apple's stable,
/// unauthenticated CDN manifest, not an API key/account-scoped resource.
const AERIAL_CATALOG_URL: &str = "https://sylvan.apple.com/Aerials/2x/entries.json";

/// One entry as Apple's manifest actually shapes it — see
/// `AERIAL_CATALOG_URL`. Only the fields this app uses are declared; serde
/// ignores the rest (id, the other quality/HDR variants, etc).
#[derive(Debug, Deserialize)]
struct AerialManifestEntry {
    #[serde(rename = "url-1080-SDR")]
    url_1080_sdr: String,
    #[serde(rename = "accessibilityLabel")]
    accessibility_label: String,
}

#[derive(Debug, Deserialize)]
struct AerialManifest {
    assets: Vec<AerialManifestEntry>,
}

/// The trimmed-down shape actually handed to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AerialVideo {
    pub name: String,
    pub url: String,
}

/// Fetches Apple's Aerial catalog and returns it in the single quality tier
/// this app plays (`1080-SDR` — plenty for a background screensaver, and a
/// far smaller download than the 4K/HDR variants). Fetched from Rust rather
/// than the browser to sidestep unverified CORS headers on the JSON endpoint
/// itself; the actual `.mov` files are played back via a plain cross-origin
/// `<video src>`, which needs no CORS at all. Callers should treat any `Err`
/// as "screensaver unavailable this session" and fail silently rather than
/// surfacing it, since this runs unattended off an idle timer.
#[command]
pub async fn fetch_aerial_catalog() -> Result<Vec<AerialVideo>, String> {
    let manifest: AerialManifest = reqwest::get(AERIAL_CATALOG_URL)
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(manifest
        .assets
        .into_iter()
        .map(|entry| AerialVideo {
            name: entry.accessibility_label,
            url: entry.url_1080_sdr,
        })
        .collect())
}

/// The tile id the screensaver hid, if it's currently up. Deliberately
/// separate from `webview::ActiveTileState` so Back/Forward/Home/Refresh/PiP
/// keep working against whatever tile is still nominally "active" while the
/// screensaver overlay covers it, rather than having those commands change
/// behavior just because the screensaver happened to kick in.
pub type ScreensaverState = Mutex<Option<String>>;

/// Hides the active tile's webview (if any) so the screensaver's DOM overlay
/// — otherwise just a same-page `<section>` — can actually appear on top of
/// it; a plain CSS `z-index` overlay only covers the launcher page's own DOM,
/// never a separately-composited native child `Webview`. Idempotent: calling
/// this while already up (or with no tile active) just re-records the
/// current state.
#[command]
pub fn enter_screensaver(app: AppHandle, screensaver: tauri::State<ScreensaverState>) {
    let label = app
        .state::<webview::ActiveTileState>()
        .lock()
        .unwrap()
        .clone();
    if let Some(label) = &label {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.hide();
        }
    }
    // The tile webview just hidden above can no longer hold keyboard focus,
    // and hiding it doesn't reliably hand focus back to the launcher page on
    // its own — without this, a keydown meant to dismiss the screensaver can
    // land nowhere at all.
    if let Some(main_window) = app.get_window("main") {
        let _ = main_window.set_focus();
    }
    *screensaver.lock().unwrap() = label;
}

/// Reverses `enter_screensaver`: re-shows and refocuses whichever tile it
/// hid, if any. No-op if the screensaver wasn't up (or that tile's webview no
/// longer exists, e.g. it was deleted from the registry in the meantime).
#[command]
pub fn exit_screensaver(app: AppHandle, screensaver: tauri::State<ScreensaverState>) {
    let Some(label) = screensaver.lock().unwrap().take() else {
        return;
    };
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.show();
        let _ = webview.set_focus();
    }
}
