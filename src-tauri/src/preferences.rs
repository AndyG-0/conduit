use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager, Runtime, State};

use crate::secrets;

/// The OS-keychain account name for the global TMDB key — see
/// `secrets.rs` for why this lives there instead of in this file's
/// persisted JSON.
const TMDB_API_KEY_ACCOUNT: &str = "tmdb_api_key";

/// App-wide user preferences, persisted separately from `registry.json`
/// (whose root is a bare array of tiles — folding a new field in there would
/// change that file's shape for existing installs).
///
/// Deliberately holds no secrets: a TMDB API key used to live here as
/// plaintext (`tmdb_api_key: Option<String>`), but any file Conduit writes
/// to disk is readable by anything else running as the same OS user, so
/// secrets now live in the OS keychain instead (`secrets.rs`). This struct
/// only ever reflects non-secret settings; `PreferencesView` is what the
/// frontend actually sees, with a computed `tmdb_api_key_set` flag standing
/// in for the key itself.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Preferences {
    /// Opt-in: the Aerial-style screensaver depends on fetching Apple's video
    /// catalog over the network at runtime, so it defaults off rather than
    /// surprising a user with an outbound request they didn't ask for.
    #[serde(default)]
    pub screensaver_enabled: bool,
    #[serde(default)]
    pub theme: Theme,
}

/// What the frontend actually receives from `get_preferences` and friends.
/// `tmdb_api_key_set` tells the settings UI whether to show "key saved" vs.
/// a blank field, without ever round-tripping the key itself back out to
/// the webview.
#[derive(Debug, Clone, Serialize)]
pub struct PreferencesView {
    pub screensaver_enabled: bool,
    pub theme: Theme,
    pub tmdb_api_key_set: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

fn preferences_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<std::path::PathBuf> {
    let dir = app.path().app_config_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("preferences.json"))
}

impl Preferences {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Self> {
        let path = preferences_path(app)?;
        let prefs = match fs::read_to_string(&path) {
            Ok(contents) => {
                let prefs: Self = serde_json::from_str(&contents).unwrap_or_default();
                // One-time migration for installs from before secrets moved
                // to the OS keychain: `preferences.json` used to hold
                // `tmdb_api_key` as plaintext. If this file still has one,
                // move it into the keychain and immediately rewrite the file
                // — `Preferences` no longer serializes that field at all, so
                // this save is what actually erases the plaintext copy
                // rather than leaving it to linger until some other setting
                // happens to change.
                if migrate_legacy_tmdb_key(&contents) {
                    let _ = prefs.save(app);
                }
                prefs
            }
            Err(_) => Self::default(),
        };
        Ok(prefs)
    }

    fn save<R: Runtime>(&self, app: &AppHandle<R>) -> tauri::Result<()> {
        let path = preferences_path(app)?;
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn view(&self) -> PreferencesView {
        PreferencesView {
            screensaver_enabled: self.screensaver_enabled,
            theme: self.theme,
            tmdb_api_key_set: secrets::has_secret(TMDB_API_KEY_ACCOUNT),
        }
    }
}

/// Returns `true` if a legacy plaintext `tmdb_api_key` was found in the raw
/// (pre-deserialize) JSON and successfully moved into the OS keychain.
/// Reading the raw JSON rather than the parsed `Preferences` is deliberate —
/// serde silently drops fields a struct no longer declares, so by the time
/// `Preferences` exists the plaintext key is already gone from view, not
/// just from disk.
fn migrate_legacy_tmdb_key(contents: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(contents) else {
        return false;
    };
    let Some(key) = value.get("tmdb_api_key").and_then(|v| v.as_str()) else {
        return false;
    };
    if key.trim().is_empty() {
        return false;
    }
    secrets::set_secret(TMDB_API_KEY_ACCOUNT, key).is_ok()
}

pub type PreferencesState = Mutex<Preferences>;

#[command]
pub fn get_preferences(preferences: State<PreferencesState>) -> PreferencesView {
    preferences.lock().unwrap().view()
}

#[command]
pub fn set_screensaver_enabled(
    app: AppHandle,
    preferences: State<PreferencesState>,
    enabled: bool,
) -> Result<PreferencesView, String> {
    let mut preferences = preferences.lock().unwrap();
    preferences.screensaver_enabled = enabled;
    preferences.save(&app).map_err(|e| e.to_string())?;
    Ok(preferences.view())
}

#[command]
pub fn set_theme(
    app: AppHandle,
    preferences: State<PreferencesState>,
    theme: Theme,
) -> Result<PreferencesView, String> {
    let mut preferences = preferences.lock().unwrap();
    preferences.theme = theme;
    preferences.save(&app).map_err(|e| e.to_string())?;
    Ok(preferences.view())
}

#[command]
pub fn set_tmdb_api_key(
    preferences: State<PreferencesState>,
    api_key: Option<String>,
) -> Result<PreferencesView, String> {
    match api_key.filter(|key| !key.trim().is_empty()) {
        Some(key) => secrets::set_secret(TMDB_API_KEY_ACCOUNT, &key)?,
        None => secrets::delete_secret(TMDB_API_KEY_ACCOUNT)?,
    }
    Ok(preferences.lock().unwrap().view())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_screensaver_disabled() {
        assert!(!Preferences::default().screensaver_enabled);
    }

    #[test]
    fn default_theme_is_system() {
        assert_eq!(Preferences::default().theme, Theme::System);
    }

    #[test]
    fn round_trips_through_json() {
        let prefs = Preferences {
            screensaver_enabled: true,
            theme: Theme::Dark,
        };
        let json = serde_json::to_string(&prefs).unwrap();
        let back: Preferences = serde_json::from_str(&json).unwrap();
        assert!(back.screensaver_enabled);
        assert_eq!(back.theme, Theme::Dark);
    }

    // `tauri::test::mock_app()` resolves `app_config_dir()` to the same real,
    // fixed path every time rather than a per-test temp dir, so a load/save
    // round trip and a fresh-file assertion can't safely live in separate
    // `#[test]` fns — Rust runs them in parallel within this binary, and
    // they'd race on that one shared `preferences.json`. Combined into one
    // test (with an explicit reset first) to stay deterministic.
    #[test]
    fn load_defaults_then_persists_across_reload() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let _ = fs::remove_file(preferences_path(&handle).unwrap());

        let prefs = Preferences::load(&handle).unwrap();
        assert!(!prefs.screensaver_enabled);
        assert_eq!(prefs.theme, Theme::System);

        let mut prefs = prefs;
        prefs.screensaver_enabled = true;
        prefs.theme = Theme::Light;
        prefs.save(&handle).unwrap();

        let reloaded = Preferences::load(&handle).unwrap();
        assert!(reloaded.screensaver_enabled);
        assert_eq!(reloaded.theme, Theme::Light);
    }
}
