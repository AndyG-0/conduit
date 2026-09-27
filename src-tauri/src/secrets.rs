use keyring::Entry;

/// All of Conduit's OS-keychain entries share this "service" identifier
/// (the app's bundle id, from `tauri.conf.json`) so they group under one
/// recognizable name in Keychain Access / Credential Manager and don't
/// collide with unrelated apps' entries for the same OS account.
const SERVICE: &str = "dev.conduit.app";

/// Every secret Conduit stores (the global TMDB key, a per-tile Jellyfin
/// key) goes through the OS-native credential store — macOS Keychain,
/// Windows Credential Manager — rather than a file Conduit itself writes.
/// The OS handles encryption at rest and access control for it; Conduit
/// managing its own encryption instead would just relocate the problem,
/// since whatever key decrypts that file would itself need to live
/// somewhere readable by the app. Never persist a secret in `registry.json`/
/// `preferences.json` — those stay plaintext-on-disk for non-secret settings
/// only.
fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    entry(account)?
        .set_password(value)
        .map_err(|e| e.to_string())
}

/// `None` covers both "never set" and "OS keychain unavailable/locked" —
/// same "unavailable this session, fail quietly" convention the rest of
/// this app's optional network features (TMDB/Jellyfin banners, the Aerial
/// screensaver catalog) already use for their own failure modes.
pub fn get_secret(account: &str) -> Option<String> {
    entry(account).ok()?.get_password().ok()
}

pub fn has_secret(account: &str) -> bool {
    get_secret(account).is_some()
}

/// A no-op, not an error, if nothing was stored for `account` — mirrors how
/// clearing an already-empty preference is treated elsewhere in this app.
pub fn delete_secret(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
