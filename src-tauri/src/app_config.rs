use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager, Runtime, State};

/// A single "app" tile in the launcher grid. `id` doubles as the webview
/// window label and the session-partition/data-directory name, so it must
/// be unique and stable once other state (partition data, an open window)
/// might reference it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppTile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub allowed_domains: Vec<String>,
    /// A `simple-icons` slug the frontend knows how to render (see
    /// `src/icons.ts`). `None` falls back to a generated monogram tile.
    #[serde(default)]
    pub icon_slug: Option<String>,
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
            &["hbomax.com", "max.com", "warnerbros.com"],
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
    if input.allowed_domains.is_empty() {
        return Err("allowed_domains must not be empty".into());
    }
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
        let tiles = match fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|_| default_seed()),
            Err(_) => {
                let seed = default_seed();
                let json = serde_json::to_string_pretty(&seed).expect("seed always serializes");
                let _ = fs::write(&path, json);
                seed
            }
        };
        Ok(Self { tiles })
    }

    fn save<R: Runtime>(&self, app: &AppHandle<R>) -> tauri::Result<()> {
        let path = registry_path(app)?;
        let json = serde_json::to_string_pretty(&self.tiles)
            .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn list(&self) -> Vec<AppTile> {
        self.tiles.clone()
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
}

pub type RegistryState = Mutex<Registry>;

#[command]
pub fn list_apps(registry: State<RegistryState>) -> Vec<AppTile> {
    registry.lock().unwrap().list()
}

#[command]
pub fn create_app(
    app: AppHandle,
    registry: State<RegistryState>,
    input: AppTileInput,
) -> Result<AppTile, String> {
    registry.lock().unwrap().add(&app, input)
}

#[command]
pub fn update_app(
    app: AppHandle,
    registry: State<RegistryState>,
    id: String,
    input: AppTileInput,
) -> Result<AppTile, String> {
    registry.lock().unwrap().update(&app, &id, input)
}

#[command]
pub fn delete_app(
    app: AppHandle,
    registry: State<RegistryState>,
    id: String,
) -> Result<(), String> {
    crate::webview::close_tile_window(&app, &id);
    registry.lock().unwrap().remove(&app, &id)
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
                input("Name", "https://example.com/", &[])
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
}
