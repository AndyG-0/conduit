use std::cmp::Ordering;
use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::secrets;

const TMDB_API_BASE: &str = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE: &str = "https://image.tmdb.org/t/p/w1280";
const TMDB_FETCH_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_TITLES_PER_TILE: usize = 5;
/// The OS-keychain account name for the global TMDB key — matches
/// `preferences::TMDB_API_KEY_ACCOUNT`, kept as a separate constant here
/// since `preferences.rs` doesn't expose it.
const TMDB_API_KEY_ACCOUNT: &str = "tmdb_api_key";

/// TMDB "watch provider" ids for the on-demand seeded tiles this app ships
/// (see `app_config::default_seed`). ESPN, YouTube TV, and Sling TV are
/// live-TV/sports services TMDB's catalog doesn't meaningfully cover, so
/// they're deliberately absent here — those tiles (and any custom tile a
/// user adds) fall back to generated artwork on the frontend instead (see
/// `src/trending.ts`'s `fallbackGradient`). This is a plain lookup, not part
/// of the persisted `AppTile` schema: it's the seam where a future per-tile
/// banner source (TMDB vs. a self-hosted service's own API, e.g. Jellyfin's)
/// would get promoted into that schema, once custom-tile banners are
/// tackled.
const TMDB_PROVIDERS: &[(&str, u32)] = &[
    ("netflix", 8),
    ("hulu", 15),
    ("disneyplus", 337),
    ("paramountplus", 531),
    ("peacock", 386),
    ("tubi", 73),
    ("hbomax", 1899),
    ("primevideo", 9),
    ("appletv", 350),
];

pub fn tmdb_provider_id(tile_id: &str) -> Option<u32> {
    TMDB_PROVIDERS
        .iter()
        .find(|(id, _)| *id == tile_id)
        .map(|(_, provider_id)| *provider_id)
}

#[derive(Debug, Clone, Serialize)]
pub struct TrendingBanner {
    pub titles: Vec<String>,
    pub backdrop_url: String,
}

/// One entry from a `/trending/{media_type}/week` response. TMDB's movie
/// results carry `title`; its TV results carry `name` — a single struct
/// covers both without needing per-media-type deserialize paths.
#[derive(Debug, Clone, Deserialize)]
struct TrendingResult {
    id: u32,
    title: Option<String>,
    name: Option<String>,
    backdrop_path: Option<String>,
    #[serde(default)]
    popularity: f32,
}

impl TrendingResult {
    fn display_title(&self) -> Option<String> {
        self.title.clone().or_else(|| self.name.clone())
    }
}

#[derive(Debug, Deserialize)]
struct TrendingResponse {
    #[serde(default)]
    results: Vec<TrendingResult>,
}

/// A title's per-region availability, as returned by
/// `/{media_type}/{id}/watch/providers`. Only `flatrate`/`free`/`ads` count
/// as "available on this service" here — `rent`/`buy` are deliberately
/// excluded, since almost every title is rentable/buyable somewhere and
/// including those would make a tile's trending list barely distinguishable
/// from any other's.
#[derive(Debug, Default, Deserialize)]
struct RegionProviders {
    #[serde(default)]
    flatrate: Vec<ProviderRef>,
    #[serde(default)]
    free: Vec<ProviderRef>,
    #[serde(default)]
    ads: Vec<ProviderRef>,
}

impl RegionProviders {
    fn provider_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.flatrate
            .iter()
            .chain(&self.free)
            .chain(&self.ads)
            .map(|p| p.provider_id)
    }
}

#[derive(Debug, Deserialize)]
struct ProviderRef {
    provider_id: u32,
}

#[derive(Debug, Deserialize)]
struct WatchProvidersResponse {
    #[serde(default)]
    results: HashMap<String, RegionProviders>,
}

fn build_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(TMDB_FETCH_TIMEOUT)
        .build()
        .ok()
}

/// Fetches this week's trending list for one media type. This is TMDB's
/// actual "what's hot right now" ranking — unlike `/discover` sorted by
/// `popularity.desc`, which surfaces all-time popular titles (long-running
/// classics dominate forever) rather than what's currently trending.
async fn trending(
    client: &reqwest::Client,
    api_key: &str,
    media_type: &str,
) -> Vec<TrendingResult> {
    let url = format!("{TMDB_API_BASE}/trending/{media_type}/week");
    let Ok(response) = client.get(&url).query(&[("api_key", api_key)]).send().await else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    response
        .json::<TrendingResponse>()
        .await
        .map(|body| body.results)
        .unwrap_or_default()
}

/// Which watch providers (by TMDB provider id) currently offer this title in
/// the US region, or empty if the lookup fails or nothing does.
async fn fetch_watch_provider_ids(
    client: &reqwest::Client,
    api_key: &str,
    media_type: &str,
    id: u32,
) -> Vec<u32> {
    let url = format!("{TMDB_API_BASE}/{media_type}/{id}/watch/providers");
    let Ok(response) = client.get(&url).query(&[("api_key", api_key)]).send().await else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let Ok(body) = response.json::<WatchProvidersResponse>().await else {
        return Vec::new();
    };
    body.results
        .get("US")
        .map(|region| region.provider_ids().collect())
        .unwrap_or_default()
}

/// Fetches trending titles/artwork for every seeded tile TMDB covers (see
/// `TMDB_PROVIDERS`), keyed by tile id. Meant to be called once per app
/// session (trending doesn't need to be real-time) and cached by the
/// frontend (`src/trending.ts`). Never errors outright: no key set in the
/// OS keychain, an unreachable network, or a bad key all just produce an
/// empty (or partial) map — same "unavailable this session" convention as
/// `screensaver::fetch_aerial_catalog`.
///
/// This pulls TMDB's actual weekly trending lists (movie + TV) once, then
/// checks each trending title's real US availability against every tile's
/// provider id — rather than asking TMDB's `/discover` endpoint to sort by
/// popularity per provider, which conflates "trending" with "historically
/// popular" and let evergreen catalog titles crowd out what's actually
/// current.
#[command]
pub async fn fetch_trending_catalog() -> HashMap<String, TrendingBanner> {
    let mut catalog = HashMap::new();
    let Some(api_key) = secrets::get_secret(TMDB_API_KEY_ACCOUNT) else {
        return catalog;
    };
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return catalog;
    }
    let Some(client) = build_client() else {
        return catalog;
    };

    let mut items: Vec<(&'static str, TrendingResult)> = Vec::new();
    for media_type in ["movie", "tv"] {
        for result in trending(&client, api_key, media_type).await {
            items.push((media_type, result));
        }
    }
    // The two lists are each already trend-ranked; sorting the merged list
    // by popularity is just a merge heuristic to interleave them sensibly.
    items.sort_by(|(_, a), (_, b)| {
        b.popularity
            .partial_cmp(&a.popularity)
            .unwrap_or(Ordering::Equal)
    });

    let mut items_with_providers = Vec::with_capacity(items.len());
    for (media_type, item) in items {
        let provider_ids = fetch_watch_provider_ids(&client, api_key, media_type, item.id).await;
        items_with_providers.push((item, provider_ids));
    }

    for (tile_id, _) in TMDB_PROVIDERS {
        let Some(provider_id) = tmdb_provider_id(tile_id) else {
            continue;
        };
        let matches: Vec<&TrendingResult> = items_with_providers
            .iter()
            .filter(|(_, ids)| ids.contains(&provider_id))
            .map(|(item, _)| item)
            .collect();
        if matches.is_empty() {
            continue;
        }
        let Some(backdrop_url) = matches
            .iter()
            .find_map(|r| r.backdrop_path.as_deref())
            .map(|path| format!("{TMDB_IMAGE_BASE}{path}"))
        else {
            continue;
        };
        let titles: Vec<String> = matches
            .iter()
            .filter_map(|r| r.display_title())
            .take(MAX_TITLES_PER_TILE)
            .collect();
        catalog.insert(
            tile_id.to_string(),
            TrendingBanner {
                titles,
                backdrop_url,
            },
        );
    }
    catalog
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_seeded_tiles_have_provider_ids() {
        for id in ["netflix", "hulu", "disneyplus", "primevideo", "appletv"] {
            assert!(
                tmdb_provider_id(id).is_some(),
                "{id} should have a provider id"
            );
        }
    }

    #[test]
    fn live_tv_tiles_have_no_provider_id() {
        for id in ["espn", "youtubetv", "slingtv"] {
            assert!(
                tmdb_provider_id(id).is_none(),
                "{id} shouldn't have a TMDB provider mapping"
            );
        }
    }

    #[test]
    fn unknown_tile_has_no_provider_id() {
        assert!(tmdb_provider_id("some-custom-tile").is_none());
    }

    #[test]
    fn trending_result_prefers_title_over_name() {
        let result = TrendingResult {
            id: 1,
            title: Some("Movie Title".to_string()),
            name: Some("TV Name".to_string()),
            backdrop_path: None,
            popularity: 0.0,
        };
        assert_eq!(result.display_title(), Some("Movie Title".to_string()));
    }

    #[test]
    fn trending_result_falls_back_to_name() {
        let result = TrendingResult {
            id: 1,
            title: None,
            name: Some("TV Name".to_string()),
            backdrop_path: None,
            popularity: 0.0,
        };
        assert_eq!(result.display_title(), Some("TV Name".to_string()));
    }

    #[test]
    fn trending_response_parses_tmdb_fixture_shape() {
        let json = r#"{
            "results": [
                {"id": 1, "title": "A Movie", "backdrop_path": "/a.jpg", "popularity": 12.3},
                {"id": 2, "name": "A Show", "backdrop_path": "/b.jpg", "popularity": 45.6}
            ]
        }"#;
        let parsed: TrendingResponse = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.results.len(), 2);
        assert_eq!(
            parsed.results[0].display_title(),
            Some("A Movie".to_string())
        );
        assert_eq!(
            parsed.results[1].display_title(),
            Some("A Show".to_string())
        );
    }

    #[test]
    fn trending_response_defaults_to_empty_results_when_missing() {
        let parsed: TrendingResponse = serde_json::from_str("{}").unwrap();
        assert!(parsed.results.is_empty());
    }

    #[test]
    fn watch_providers_response_parses_tmdb_fixture_shape() {
        let json = r#"{
            "id": 1,
            "results": {
                "US": {
                    "flatrate": [{"provider_id": 8, "provider_name": "Netflix"}],
                    "ads": [{"provider_id": 73, "provider_name": "Tubi"}],
                    "rent": [{"provider_id": 2, "provider_name": "Apple TV"}]
                }
            }
        }"#;
        let parsed: WatchProvidersResponse = serde_json::from_str(json).unwrap();
        let us = parsed.results.get("US").unwrap();
        let ids: Vec<u32> = us.provider_ids().collect();
        assert!(ids.contains(&8));
        assert!(ids.contains(&73));
        assert!(!ids.contains(&2), "rent-only providers should be excluded");
    }

    #[test]
    fn watch_providers_response_defaults_to_empty_when_region_missing() {
        let parsed: WatchProvidersResponse = serde_json::from_str("{}").unwrap();
        assert!(parsed.results.is_empty());
    }
}
