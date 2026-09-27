use std::time::Duration;

use serde::Deserialize;
use tauri::command;
use url::Url;

use crate::secrets;
use crate::trending::TrendingBanner;

const JELLYFIN_FETCH_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_TITLES_PER_TILE: usize = 5;
/// Requested above `MAX_TITLES_PER_TILE` so there's a decent chance at least
/// one of the returned items actually has a backdrop image to use as the
/// banner's `backdrop_url` — some recently-added items (e.g. a lone episode)
/// don't carry one.
const LATEST_FETCH_LIMIT: usize = 12;

/// One entry from `GET /Users`. Unlike `/Items/Latest` below, this endpoint
/// serializes PascalCase (`"Id"`, not `"id"`) — Jellyfin isn't consistent
/// about it across endpoints, so each struct here matches what its own
/// endpoint actually sends rather than assuming a single convention.
///
/// A server-wide Jellyfin API key isn't bound
/// to a user (unlike a per-user login token), but `/Items/Latest` needs a
/// `userId` — this is only ever used to pick *a* library-visible account for
/// a decorative banner, not for any access-control decision, so grabbing the
/// first one back is an acceptable heuristic for the common single-user
/// self-hosted case. On a multi-user server it may reflect whichever
/// account's library view happens to come back first.
#[derive(Debug, Deserialize)]
struct JellyfinUser {
    #[serde(rename = "Id")]
    id: String,
}

/// One entry from `GET /Items/Latest`. Like `/Users` above, Jellyfin sends
/// this PascalCase (`"Id"`, `"Name"`, `"BackdropImageTags"`) — there's no
/// camelCase convention to rely on here despite what it might look like from
/// the SDK's C# model names. `BackdropImageTags` is an empty array (not
/// absent) when an item has no backdrop image of its own.
#[derive(Debug, Deserialize)]
struct JellyfinLatestItem {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "BackdropImageTags", default)]
    backdrop_image_tags: Vec<String>,
}

/// A tile's `base_url` is what its webview actually navigates to — commonly
/// something like `http://host:8096/web/#/home`, the SPA route, not the
/// server root. Jellyfin's REST API is mounted at the server root
/// (`/Users`, `/Items/Latest`, ...), so every API call needs just the
/// scheme+host+port with the path/query/fragment stripped off. Returns
/// `None` for a URL that doesn't even parse.
fn api_root(base_url: &str) -> Option<String> {
    let mut url = Url::parse(base_url.trim()).ok()?;
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Some(url.to_string().trim_end_matches('/').to_string())
}

/// The OS-keychain account name for one tile's Jellyfin key. Namespaced by
/// tile id since each Jellyfin tile points at its own self-hosted server —
/// unlike the single global TMDB key (`preferences::TMDB_API_KEY_ACCOUNT`).
/// Public: `app_config::AppTile::view` also needs it to compute
/// `jellyfin_api_key_set` without duplicating the naming scheme.
pub fn jellyfin_keychain_account(tile_id: &str) -> String {
    format!("jellyfin:{tile_id}")
}

fn build_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(JELLYFIN_FETCH_TIMEOUT)
        .build()
        .ok()
}

async fn fetch_first_user_id(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> Option<String> {
    let url = format!("{base_url}/Users");
    let Ok(response) = client
        .get(&url)
        .header("X-Emby-Token", api_key)
        .send()
        .await
    else {
        return None;
    };
    if !response.status().is_success() {
        return None;
    }
    let users = response.json::<Vec<JellyfinUser>>().await.ok()?;
    users.into_iter().next().map(|u| u.id)
}

/// Fetches recently-added items across every library the looked-up user can
/// see. Omitting `parentId` is deliberate, not an oversight — Jellyfin's own
/// `/Items/Latest` handler falls back to the user's full library-view list
/// when no parent is given, so this needs no per-tile "which library" setup.
async fn fetch_latest_items(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    user_id: &str,
) -> Vec<JellyfinLatestItem> {
    let url = format!("{base_url}/Items/Latest");
    let limit = LATEST_FETCH_LIMIT.to_string();
    let Ok(response) = client
        .get(&url)
        .header("X-Emby-Token", api_key)
        .query(&[("userId", user_id), ("limit", limit.as_str())])
        .send()
        .await
    else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    response
        .json::<Vec<JellyfinLatestItem>>()
        .await
        .unwrap_or_default()
}

fn first_backdrop_item(items: &[JellyfinLatestItem]) -> Option<&JellyfinLatestItem> {
    items
        .iter()
        .find(|item| !item.backdrop_image_tags.is_empty())
}

/// Auth via an `?ApiKey=` query param rather than the `X-Emby-Token` header
/// the JSON calls above use — this URL is handed straight to an `<img src>`
/// on the frontend, which can't attach a custom header.
fn image_url(base_url: &str, item_id: &str, api_key: &str) -> String {
    let path = format!("{base_url}/Items/{item_id}/Images/Backdrop");
    match Url::parse(&path) {
        Ok(mut url) => {
            url.query_pairs_mut()
                .append_pair("maxWidth", "1280")
                .append_pair("quality", "90")
                .append_pair("ApiKey", api_key);
            url.to_string()
        }
        Err(_) => path,
    }
}

/// Fetches one tile's Jellyfin "recently added" artwork/titles for the hero
/// banner — the self-hosted counterpart to `trending::fetch_trending_catalog`
/// for TMDB-covered tiles (see that module's `TMDB_PROVIDERS` doc comment,
/// which calls this out as the seam a per-tile source like Jellyfin's would
/// fill). Never errors outright: no key set for this tile, an unreachable
/// server, or a bad key all just produce `None` — same "unavailable this
/// session" convention as `trending::fetch_trending_catalog`.
#[command]
pub async fn fetch_jellyfin_banner(tile_id: String, base_url: String) -> Option<TrendingBanner> {
    let base_url = api_root(&base_url)?;
    if base_url.is_empty() {
        return None;
    }
    let api_key = secrets::get_secret(&jellyfin_keychain_account(&tile_id))?;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return None;
    }
    let client = build_client()?;

    let user_id = fetch_first_user_id(&client, &base_url, api_key).await?;
    let items = fetch_latest_items(&client, &base_url, api_key, &user_id).await;

    let backdrop_item = first_backdrop_item(&items)?;
    let backdrop_url = image_url(&base_url, &backdrop_item.id, api_key);

    let titles: Vec<String> = items
        .iter()
        .filter_map(|item| item.name.clone())
        .take(MAX_TITLES_PER_TILE)
        .collect();

    Some(TrendingBanner {
        titles,
        backdrop_url,
    })
}

/// Sets or clears one tile's Jellyfin API key in the OS keychain. Decoupled
/// from `app_config::update_app`/`create_app` — the tile-CRUD commands never
/// see the raw key, only a computed `jellyfin_api_key_set` flag (see
/// `app_config::AppTileView`) — so this is the only path that ever writes or
/// deletes it.
#[command]
pub fn set_jellyfin_api_key(tile_id: String, api_key: Option<String>) -> Result<(), String> {
    let account = jellyfin_keychain_account(&tile_id);
    match api_key.filter(|key| !key.trim().is_empty()) {
        Some(key) => secrets::set_secret(&account, &key),
        None => secrets::delete_secret(&account),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_root_strips_the_spa_hash_route_off_a_tile_base_url() {
        assert_eq!(
            api_root("http://192.168.50.50:8096/web/#/home").as_deref(),
            Some("http://192.168.50.50:8096")
        );
    }

    #[test]
    fn api_root_strips_trailing_slash_from_a_bare_server_url() {
        assert_eq!(
            api_root("http://192.168.50.50:8096/").as_deref(),
            Some("http://192.168.50.50:8096")
        );
    }

    #[test]
    fn api_root_is_none_for_an_unparseable_url() {
        assert!(api_root("not a url").is_none());
    }

    #[test]
    fn users_response_parses_jellyfin_fixture_shape() {
        let json = r#"[{"Name": "Admin", "Id": "abc123", "HasPassword": true}]"#;
        let parsed: Vec<JellyfinUser> = serde_json::from_str(json).unwrap();
        assert_eq!(parsed[0].id, "abc123");
    }

    #[test]
    fn latest_item_parses_pascal_case_backdrop_tags() {
        let json = r#"{
            "Id": "item1",
            "Name": "A Show",
            "BackdropImageTags": ["tag1"]
        }"#;
        let parsed: JellyfinLatestItem = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.id, "item1");
        assert_eq!(parsed.name.as_deref(), Some("A Show"));
        assert_eq!(parsed.backdrop_image_tags, vec!["tag1".to_string()]);
    }

    #[test]
    fn latest_item_defaults_backdrop_tags_to_empty_when_missing() {
        let json = r#"{"Id": "item1", "Name": "A Show"}"#;
        let parsed: JellyfinLatestItem = serde_json::from_str(json).unwrap();
        assert!(parsed.backdrop_image_tags.is_empty());
    }

    fn item(id: &str, has_backdrop: bool) -> JellyfinLatestItem {
        JellyfinLatestItem {
            id: id.to_string(),
            name: Some(id.to_string()),
            backdrop_image_tags: if has_backdrop {
                vec!["tag".to_string()]
            } else {
                vec![]
            },
        }
    }

    #[test]
    fn first_backdrop_item_skips_items_without_a_backdrop() {
        let items = vec![item("no-backdrop", false), item("has-backdrop", true)];
        let found = first_backdrop_item(&items).unwrap();
        assert_eq!(found.id, "has-backdrop");
    }

    #[test]
    fn first_backdrop_item_is_none_when_nothing_qualifies() {
        let items = vec![item("no-backdrop-1", false), item("no-backdrop-2", false)];
        assert!(first_backdrop_item(&items).is_none());
    }

    #[test]
    fn image_url_includes_api_key_and_item_id() {
        let url = image_url("https://jf.example.com", "item1", "secret-key");
        assert!(url.starts_with("https://jf.example.com/Items/item1/Images/Backdrop?"));
        assert!(url.contains("ApiKey=secret-key"));
        assert!(url.contains("maxWidth=1280"));
    }
}
