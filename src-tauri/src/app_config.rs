use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager, Runtime, State};

use crate::jellyfin::jellyfin_keychain_account;
use crate::secrets;

/// A single "app" tile in the launcher grid. `id` doubles as the webview
/// window label and the session-partition/data-directory name, so it must
/// be unique and stable once other state (partition data, an open window)
/// might reference it.
///
/// Deliberately holds no secrets: a per-tile Jellyfin API key is never part
/// of this struct or `registry.json` — it lives in the OS keychain instead
/// (`secrets.rs`), keyed by tile id. `AppTileView` is what the frontend
/// actually sees, with a computed `jellyfin_api_key_set` flag standing in
/// for the key itself.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppTile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    /// Extra domains a tile's webview may navigate to, beyond its own
    /// `base_url` host and the shared SSO allowlist — see
    /// `AppTileInput::allowed_domains`.
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    /// A `simple-icons` slug the frontend knows how to render (see
    /// `src/icons.ts`). `None` falls back to a generated monogram tile.
    #[serde(default)]
    pub icon_slug: Option<String>,
}

/// What the frontend actually receives from `list_apps`/`create_app`/
/// `update_app`. `jellyfin_api_key_set` tells the settings UI whether to
/// show "key saved" vs. a blank field, without ever round-tripping the key
/// itself back out to the webview.
#[derive(Debug, Clone, Serialize)]
pub struct AppTileView {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub allowed_domains: Vec<String>,
    pub icon_slug: Option<String>,
    pub jellyfin_api_key_set: bool,
}

impl AppTile {
    pub fn view(&self) -> AppTileView {
        AppTileView {
            id: self.id.clone(),
            name: self.name.clone(),
            base_url: self.base_url.clone(),
            allowed_domains: self.allowed_domains.clone(),
            icon_slug: self.icon_slug.clone(),
            jellyfin_api_key_set: secrets::has_secret(&jellyfin_keychain_account(&self.id)),
        }
    }
}

/// Lowercases and replaces anything that isn't `[a-z0-9-]` with `-`,
/// collapsing repeats and trimming leading/trailing `-`. Used to derive a
/// stable `id` from a user-supplied display name in the settings UI.
fn slugify(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut last_was_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

/// The curated set of streaming services shipped by default. Real base
/// URLs and allowed domains as of writing; a user hitting an SSO domain
/// not covered here (or by `crate::webview::COMMON_SSO_DOMAINS`) can add it
/// through the settings UI.
pub fn default_seed() -> Vec<AppTile> {
    fn tile(id: &str, name: &str, base_url: &str, domains: &[&str], icon: &str) -> AppTile {
        AppTile {
            id: id.to_string(),
            name: name.to_string(),
            base_url: base_url.to_string(),
            allowed_domains: domains.iter().map(|d| d.to_string()).collect(),
            icon_slug: Some(icon.to_string()),
        }
    }

    vec![
        tile(
            "netflix",
            "Netflix",
            "https://www.netflix.com/",
            &["netflix.com"],
            "netflix",
        ),
        tile(
            "hulu",
            "Hulu",
            "https://www.hulu.com/",
            &["hulu.com", "disney.com", "disneyplus.com"],
            "hulu",
        ),
        tile(
            "disneyplus",
            "Disney+",
            "https://www.disneyplus.com/",
            &["disneyplus.com", "disney.com", "go.com"],
            "disneyplus",
        ),
        tile(
            "paramountplus",
            "Paramount+",
            "https://www.paramountplus.com/",
            &["paramountplus.com", "cbs.com"],
            "paramountplus",
        ),
        tile(
            "peacock",
            "Peacock",
            "https://www.peacocktv.com/",
            &["peacocktv.com", "nbc.com"],
            "peacock",
        ),
        tile(
            "tubi",
            "Tubi",
            "https://tubitv.com/",
            &["tubitv.com", "facebook.com"],
            "tubi",
        ),
        tile(
            "espn",
            "ESPN",
            "https://www.espn.com/",
            &[
                "espn.com",
                "plus.espn.com",
                "espnplus.com",
                "disney.com",
                "go.com",
            ],
            "espn",
        ),
        tile(
            "youtubetv",
            "YouTube TV",
            "https://tv.youtube.com/",
            &["youtube.com", "google.com"],
            "youtubetv",
        ),
        tile(
            "slingtv",
            "Sling TV",
            "https://www.sling.com/",
            &["sling.com"],
            "slingtv",
        ),
        tile(
            "hbomax",
            "HBO Max",
            "https://www.hbomax.com/",
            // `warnermediacdn.com` is WarnerMedia's own CDN, not a
            // third-party ad domain — HBO Max's login flow hits
            // `lightning.warnermediacdn.com/cdp/psmtk/getcdpid.html` for a
            // device-id/anti-fraud check, and without it allowed the
            // request was silently blocked like the unrelated ad/tracking
            // pixels alongside it. Same failure shape as the missing
            // reCAPTCHA host that broke Hulu's login (see
            // `COMMON_CAPTCHA_DOMAINS` in webview.rs). `hbogo.com` is the
            // legacy HBO GO/HBO NOW domain WarnerMedia's identity provider
            // still runs on — the actual sign-in form posts to
            // `auth.hbogo.com` via a SAML redirect, which was being blocked
            // identically to the ad/tracking hosts in the same login flow.
            &[
                "hbomax.com",
                "max.com",
                "warnerbros.com",
                "warnermediacdn.com",
                "hbogo.com",
            ],
            "hbomax",
        ),
        tile(
            "primevideo",
            "Prime Video",
            "https://www.primevideo.com/",
            &["primevideo.com", "amazon.com"],
            "amazonprimevideo",
        ),
        tile(
            "appletv",
            "Apple TV+",
            "https://tv.apple.com/",
            &["apple.com"],
            "appletv",
        ),
    ]
}

/// Fields a caller supplies when creating or updating a tile. `id` is
/// derived from `name` on create (see `slugify`) rather than user-supplied
/// directly, so the settings UI can't produce a mismatched id/partition.
#[derive(Debug, Clone, Deserialize)]
pub struct AppTileInput {
    pub name: String,
    pub base_url: String,
    /// Extra domains a tile's webview may navigate to, *beyond* its own
    /// `base_url` host (always allowed automatically, see
    /// `crate::webview::effective_allowed_domains`) and the shared SSO
    /// allowlist (`crate::webview::COMMON_SSO_DOMAINS`). Usually empty — only
    /// needed for a tile whose login/playback flow crosses onto another
    /// brand's domain those don't already cover.
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub icon_slug: Option<String>,
}

fn validate_input(input: &AppTileInput) -> Result<(), String> {
    if input.name.trim().is_empty() {
        return Err("name must not be empty".into());
    }
    if input.base_url.trim().is_empty() {
        return Err("base_url must not be empty".into());
    }
    url::Url::parse(&input.base_url).map_err(|e| format!("base_url is not a valid URL: {e}"))?;
    Ok(())
}

/// The user-editable "channel lineup". Persisted as JSON in the app config
/// directory; seeded with `default_seed()` on first run.
pub struct Registry {
    tiles: Vec<AppTile>,
}

fn registry_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<std::path::PathBuf> {
    let dir = app.path().app_config_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("registry.json"))
}

impl Registry {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Self> {
        let path = registry_path(app)?;
        let (tiles, needs_resave) = match fs::read_to_string(&path) {
            Ok(contents) => {
                let tiles: Vec<AppTile> =
                    serde_json::from_str(&contents).unwrap_or_else(|_| default_seed());
                // Same one-time migration as `Preferences::load` for
                // installs from before secrets moved to the OS keychain:
                // `registry.json` used to hold each tile's `jellyfin_api_key`
                // as plaintext.
                (tiles, migrate_legacy_jellyfin_keys(&contents))
            }
            Err(_) => {
                let seed = default_seed();
                let json = serde_json::to_string_pretty(&seed).expect("seed always serializes");
                let _ = fs::write(&path, json);
                (seed, false)
            }
        };
        let registry = Self { tiles };
        if needs_resave {
            let _ = registry.save(app);
        }
        Ok(registry)
    }

    fn save<R: Runtime>(&self, app: &AppHandle<R>) -> tauri::Result<()> {
        let path = registry_path(app)?;
        let json = serde_json::to_string_pretty(&self.tiles)
            .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn list(&self) -> Vec<AppTileView> {
        self.tiles.iter().map(AppTile::view).collect()
    }

    pub fn get(&self, id: &str) -> Option<&AppTile> {
        self.tiles.iter().find(|t| t.id == id)
    }

    fn unique_id_from(&self, name: &str) -> String {
        let base = slugify(name);
        let base = if base.is_empty() {
            "app".to_string()
        } else {
            base
        };
        if !self.tiles.iter().any(|t| t.id == base) {
            return base;
        }
        let mut n = 2;
        loop {
            let candidate = format!("{base}-{n}");
            if !self.tiles.iter().any(|t| t.id == candidate) {
                return candidate;
            }
            n += 1;
        }
    }

    pub fn add<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        input: AppTileInput,
    ) -> Result<AppTile, String> {
        validate_input(&input)?;
        let id = self.unique_id_from(&input.name);
        let tile = AppTile {
            id,
            name: input.name,
            base_url: input.base_url,
            allowed_domains: input.allowed_domains,
            icon_slug: input.icon_slug,
        };
        self.tiles.push(tile.clone());
        self.save(app).map_err(|e| e.to_string())?;
        Ok(tile)
    }

    pub fn update<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        id: &str,
        input: AppTileInput,
    ) -> Result<AppTile, String> {
        validate_input(&input)?;
        let existing = self
            .tiles
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| format!("no tile with id {id}"))?;
        existing.name = input.name;
        existing.base_url = input.base_url;
        existing.allowed_domains = input.allowed_domains;
        existing.icon_slug = input.icon_slug;
        let updated = existing.clone();
        self.save(app).map_err(|e| e.to_string())?;
        Ok(updated)
    }

    pub fn remove<R: Runtime>(&mut self, app: &AppHandle<R>, id: &str) -> Result<(), String> {
        let len_before = self.tiles.len();
        self.tiles.retain(|t| t.id != id);
        if self.tiles.len() == len_before {
            return Err(format!("no tile with id {id}"));
        }
        self.save(app).map_err(|e| e.to_string())
    }

    /// Rebuilds tile order to match `ids`, which must be a permutation of
    /// the existing tile ids exactly — same length *and* same set, which
    /// together rule out a missing id, an unknown id, and a duplicate id in
    /// one check (a length-only check would miss a duplicate standing in
    /// for a dropped one).
    pub fn reorder<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        ids: &[String],
    ) -> Result<(), String> {
        if ids.len() != self.tiles.len() {
            return Err("ids must match the current set of tiles exactly".into());
        }
        let existing: std::collections::HashSet<&str> =
            self.tiles.iter().map(|t| t.id.as_str()).collect();
        let given: std::collections::HashSet<&str> = ids.iter().map(|id| id.as_str()).collect();
        if given.len() != ids.len() || given != existing {
            return Err("ids must match the current set of tiles exactly".into());
        }
        let reordered = ids
            .iter()
            .map(|id| self.tiles.iter().find(|t| &t.id == id).unwrap().clone())
            .collect();
        self.tiles = reordered;
        self.save(app).map_err(|e| e.to_string())
    }
}

/// Returns `true` if any tile's legacy plaintext `jellyfin_api_key` was
/// found in the raw (pre-deserialize) JSON and successfully moved into the
/// OS keychain. Reading the raw JSON rather than the parsed tiles is
/// deliberate — see `preferences::migrate_legacy_tmdb_key`'s doc comment for
/// why.
fn migrate_legacy_jellyfin_keys(contents: &str) -> bool {
    let Ok(serde_json::Value::Array(tiles)) = serde_json::from_str(contents) else {
        return false;
    };
    let mut migrated_any = false;
    for tile in &tiles {
        let Some(id) = tile.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(key) = tile.get("jellyfin_api_key").and_then(|v| v.as_str()) else {
            continue;
        };
        if key.trim().is_empty() {
            continue;
        }
        if secrets::set_secret(&jellyfin_keychain_account(id), key).is_ok() {
            migrated_any = true;
        }
    }
    migrated_any
}

pub type RegistryState = Mutex<Registry>;

#[command]
pub fn list_apps(registry: State<RegistryState>) -> Vec<AppTileView> {
    registry.lock().unwrap().list()
}

#[command]
pub fn create_app(
    app: AppHandle,
    registry: State<RegistryState>,
    input: AppTileInput,
) -> Result<AppTileView, String> {
    registry.lock().unwrap().add(&app, input).map(|t| t.view())
}

#[command]
pub fn update_app(
    app: AppHandle,
    registry: State<RegistryState>,
    id: String,
    input: AppTileInput,
) -> Result<AppTileView, String> {
    registry
        .lock()
        .unwrap()
        .update(&app, &id, input)
        .map(|t| t.view())
}

#[command]
pub fn delete_app(
    app: AppHandle,
    registry: State<RegistryState>,
    id: String,
) -> Result<(), String> {
    crate::webview::close_tile_window(&app, &id);
    crate::webview::close_pip_if_empty(&app);
    let result = registry.lock().unwrap().remove(&app, &id);
    // Best-effort: an already-missing keychain entry is a no-op (see
    // `secrets::delete_secret`), so this never blocks tile removal even if
    // no Jellyfin key was ever set for it.
    let _ = secrets::delete_secret(&jellyfin_keychain_account(&id));
    result
}

#[command]
pub fn reorder_apps(
    app: AppHandle,
    registry: State<RegistryState>,
    ids: Vec<String>,
) -> Result<(), String> {
    registry.lock().unwrap().reorder(&app, &ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, base_url: &str, domains: &[&str]) -> AppTileInput {
        AppTileInput {
            name: name.to_string(),
            base_url: base_url.to_string(),
            allowed_domains: domains.iter().map(|d| d.to_string()).collect(),
            icon_slug: None,
        }
    }

    fn empty_registry() -> Registry {
        Registry { tiles: vec![] }
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Disney+"), "disney");
        assert_eq!(slugify("YouTube TV"), "youtube-tv");
        assert_eq!(slugify("  Sling TV  "), "sling-tv");
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn default_seed_ids_are_unique() {
        let seed = default_seed();
        let mut ids: Vec<&str> = seed.iter().map(|t| t.id.as_str()).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "default_seed has duplicate ids");
    }

    #[test]
    fn default_seed_round_trips_through_json() {
        let seed = default_seed();
        let json = serde_json::to_string(&seed).unwrap();
        let back: Vec<AppTile> = serde_json::from_str(&json).unwrap();
        assert_eq!(seed, back);
    }

    #[test]
    fn unique_id_from_deduplicates_slug_collisions() {
        let mut registry = empty_registry();
        registry.tiles.push(AppTile {
            id: "test".into(),
            name: "Test".into(),
            base_url: "https://example.com/".into(),
            allowed_domains: vec!["example.com".into()],
            icon_slug: None,
        });
        assert_eq!(registry.unique_id_from("Test"), "test-2");
        assert_eq!(registry.unique_id_from("Something Else"), "something-else");
    }

    #[test]
    fn add_rejects_empty_required_fields() {
        let mut registry = empty_registry();
        assert!(registry
            .add(
                &tauri::test::mock_app().handle().clone(),
                input("", "https://example.com/", &["example.com"])
            )
            .is_err());
        assert!(registry
            .add(
                &tauri::test::mock_app().handle().clone(),
                input("Name", "", &["example.com"])
            )
            .is_err());
        assert!(registry
            .add(
                &tauri::test::mock_app().handle().clone(),
                input("Name", "not a url", &["example.com"])
            )
            .is_err());
    }

    #[test]
    fn add_accepts_empty_allowed_domains() {
        let mut registry = empty_registry();
        assert!(registry
            .add(
                &tauri::test::mock_app().handle().clone(),
                input("Name", "https://example.com/", &[])
            )
            .is_ok());
    }

    #[test]
    fn add_assigns_slugified_unique_id_and_persists() {
        let app = tauri::test::mock_app();
        let mut registry = empty_registry();
        let tile = registry
            .add(
                app.handle(),
                input("My Service", "https://example.com/", &["example.com"]),
            )
            .unwrap();
        assert_eq!(tile.id, "my-service");
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn update_rejects_unknown_id() {
        let app = tauri::test::mock_app();
        let mut registry = empty_registry();
        let result = registry.update(
            app.handle(),
            "nonexistent",
            input("Name", "https://example.com/", &["example.com"]),
        );
        assert!(result.is_err());
    }

    #[test]
    fn remove_rejects_unknown_id_and_removes_known_one() {
        let app = tauri::test::mock_app();
        let mut registry = empty_registry();
        let tile = registry
            .add(
                app.handle(),
                input("My Service", "https://example.com/", &["example.com"]),
            )
            .unwrap();
        assert!(registry.remove(app.handle(), "nonexistent").is_err());
        assert!(registry.remove(app.handle(), &tile.id).is_ok());
        assert!(registry.list().is_empty());
    }

    fn seed_three<R: Runtime>(registry: &mut Registry, app: &AppHandle<R>) -> Vec<String> {
        ["One", "Two", "Three"]
            .iter()
            .map(|name| {
                registry
                    .add(app, input(name, "https://example.com/", &["example.com"]))
                    .unwrap()
                    .id
            })
            .collect()
    }

    #[test]
    fn reorder_persists_new_order() {
        let app = tauri::test::mock_app();
        let mut registry = empty_registry();
        let ids = seed_three(&mut registry, app.handle());
        let permuted = vec![ids[2].clone(), ids[0].clone(), ids[1].clone()];

        assert!(registry.reorder(app.handle(), &permuted).is_ok());
        let listed: Vec<String> = registry.list().into_iter().map(|t| t.id).collect();
        assert_eq!(listed, permuted);

        // Round-trips through `registry.json`, not just the in-memory vec.
        let reloaded = Registry::load(app.handle()).unwrap();
        let reloaded_ids: Vec<String> = reloaded.list().into_iter().map(|t| t.id).collect();
        assert_eq!(reloaded_ids, permuted);
    }

    #[test]
    fn reorder_rejects_missing_id() {
        let app = tauri::test::mock_app();
        let mut registry = empty_registry();
        let ids = seed_three(&mut registry, app.handle());
        let missing_one = vec![ids[0].clone(), ids[1].clone()];
        assert!(registry.reorder(app.handle(), &missing_one).is_err());
    }

    #[test]
    fn reorder_rejects_unknown_id() {
        let app = tauri::test::mock_app();
        let mut registry = empty_registry();
        let ids = seed_three(&mut registry, app.handle());
        let with_unknown = vec![ids[0].clone(), ids[1].clone(), "nonexistent".to_string()];
        assert!(registry.reorder(app.handle(), &with_unknown).is_err());
    }

    #[test]
    fn reorder_rejects_duplicate_id() {
        let app = tauri::test::mock_app();
        let mut registry = empty_registry();
        let ids = seed_three(&mut registry, app.handle());
        let with_duplicate = vec![ids[0].clone(), ids[0].clone(), ids[1].clone()];
        assert!(registry.reorder(app.handle(), &with_duplicate).is_err());
    }
}
