import { invoke } from "@tauri-apps/api/core";
import { monogramColor } from "./icons";
import type { Preferences, TrendingBanner } from "./types";

/**
 * Populated once per app session by `refreshTrendingCatalog`, read
 * synchronously by `updateTileBanner` the same way `currentTiles` is in
 * `main.ts`. Keyed by tile id; only seeded on-demand tiles TMDB covers ever
 * have an entry (see `src-tauri/src/trending.rs`'s `TMDB_PROVIDERS`) — any
 * other tile (ESPN/YouTube TV/Sling TV, or a custom tile) simply has none.
 */
let catalog: Record<string, TrendingBanner> = {};

export function trendingFor(tileId: string): TrendingBanner | null {
  return catalog[tileId] ?? null;
}

/**
 * Folds a banner from another source (currently `jellyfin.ts`) into the
 * same cache `trendingFor` reads, so `main.ts`'s rendering path stays
 * source-agnostic instead of needing a parallel lookup per banner source.
 */
export function setBannerFor(tileId: string, banner: TrendingBanner): void {
  catalog[tileId] = banner;
}

/**
 * A generated brand-color gradient, used as the hero banner's backdrop for
 * any tile TMDB doesn't have real trending data for. Reuses the same
 * per-tile color already used for the monogram icon fallback
 * (`icons.ts`'s `monogramColor`) rather than requiring separately bundled
 * and licensed marketing artwork.
 */
export function fallbackGradient(name: string): string {
  const color = monogramColor(name);
  return `linear-gradient(135deg, ${color}, var(--bg-page))`;
}

/**
 * Fetches trending titles/artwork for every tile TMDB covers, once per
 * session, and calls `onUpdate` if it got anything back. Silently does
 * nothing if no TMDB API key is configured (Settings) or the request
 * fails — same "unavailable this session" convention as the Aerial
 * screensaver catalog fetch in `screensaver.ts`.
 */
export async function refreshTrendingCatalog(
  onUpdate: () => void,
): Promise<void> {
  const preferences = await invoke<Preferences>("get_preferences").catch(
    () => null,
  );
  if (!preferences?.tmdb_api_key_set) return;

  const fetched = await invoke<Record<string, TrendingBanner>>(
    "fetch_trending_catalog",
  ).catch(() => null);
  if (!fetched || Object.keys(fetched).length === 0) return;

  // Merge, don't replace: `refreshAllJellyfinBanners` runs concurrently and
  // folds its own entries into this same cache via `setBannerFor` — since
  // the two fetches race, whichever resolves second must not stomp on
  // entries the other already added.
  catalog = { ...catalog, ...fetched };
  onUpdate();
}
