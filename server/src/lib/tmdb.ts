import type { TrendingBanner } from "@conduit/shared";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w1280";
const TMDB_FETCH_TIMEOUT_MS = 6000;
const MAX_TITLES_PER_TILE = 5;

/**
 * TMDB "watch provider" ids for the on-demand seeded tiles this app ships
 * (see `registry.ts`'s default seed). ESPN, YouTube TV, and Sling TV are
 * live-TV/sports services TMDB's catalog doesn't meaningfully cover, so
 * they're deliberately absent here — those tiles (and any custom tile a
 * user adds) fall back to generated artwork on the frontend instead. Ported
 * from `TMDB_PROVIDERS` in `src-tauri/src/trending.rs`.
 */
export const TMDB_PROVIDERS: Record<string, number> = {
  netflix: 8,
  hulu: 15,
  disneyplus: 337,
  paramountplus: 531,
  peacock: 386,
  tubi: 73,
  hbomax: 1899,
  primevideo: 9,
  appletv: 350,
};

/** One entry from a `/trending/{media_type}/week` response. TMDB's movie
 * results carry `title`; its TV results carry `name` — a single interface
 * covers both without needing per-media-type parsing paths. */
interface TmdbTrendingResult {
  id: number;
  title?: string;
  name?: string;
  backdrop_path?: string | null;
  popularity?: number;
}

function displayTitle(result: TmdbTrendingResult): string | undefined {
  return result.title ?? result.name;
}

interface TmdbProviderRef {
  provider_id: number;
}

/** A title's per-region availability, as returned by
 * `/{media_type}/{id}/watch/providers`. Only `flatrate`/`free`/`ads` count
 * as "available on this service" here — `rent`/`buy` are deliberately
 * excluded, since almost every title is rentable/buyable somewhere and
 * including those would make a tile's trending list barely distinguishable
 * from any other's. */
interface TmdbRegionProviders {
  flatrate?: TmdbProviderRef[];
  free?: TmdbProviderRef[];
  ads?: TmdbProviderRef[];
}

function regionProviderIds(region: TmdbRegionProviders): number[] {
  return [
    ...(region.flatrate ?? []),
    ...(region.free ?? []),
    ...(region.ads ?? []),
  ].map((p) => p.provider_id);
}

async function fetchTmdbJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TMDB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches this week's trending list for one media type. This is TMDB's
 * actual "what's hot right now" ranking — unlike `/discover` sorted by
 * `popularity.desc`, which surfaces all-time popular titles (long-running
 * classics dominate forever) rather than what's currently trending. */
async function trending(
  apiKey: string,
  mediaType: "movie" | "tv",
): Promise<TmdbTrendingResult[]> {
  const url = `${TMDB_API_BASE}/trending/${mediaType}/week?api_key=${encodeURIComponent(apiKey)}`;
  const body = await fetchTmdbJson<{ results?: TmdbTrendingResult[] }>(url);
  return body?.results ?? [];
}

/** Which watch providers (by TMDB provider id) currently offer this title in
 * the US region, or empty if the lookup fails or nothing does. */
async function fetchWatchProviderIds(
  apiKey: string,
  mediaType: "movie" | "tv",
  id: number,
): Promise<number[]> {
  const url = `${TMDB_API_BASE}/${mediaType}/${id}/watch/providers?api_key=${encodeURIComponent(apiKey)}`;
  const body = await fetchTmdbJson<{
    results?: Record<string, TmdbRegionProviders>;
  }>(url);
  const us = body?.results?.US;
  return us ? regionProviderIds(us) : [];
}

/**
 * Fetches trending titles/artwork for every seeded tile TMDB covers (see
 * `TMDB_PROVIDERS`), keyed by tile id. Meant to be called once per session
 * and cached by the caller (`web/src/trending.ts`). Never throws: no key, an
 * unreachable network, or a bad key all just produce an empty (or partial)
 * map.
 *
 * This pulls TMDB's actual weekly trending lists (movie + TV) once, then
 * checks each trending title's real US availability against every tile's
 * provider id — rather than asking TMDB's `/discover` endpoint to sort by
 * popularity per provider, which conflates "trending" with "historically
 * popular" and would let evergreen catalog titles crowd out what's actually
 * current. Ported from `fetch_trending_catalog` in `src-tauri/src/trending.rs`.
 */
export async function fetchTrendingCatalog(
  apiKey: string,
): Promise<Record<string, TrendingBanner>> {
  const catalog: Record<string, TrendingBanner> = {};
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) return catalog;

  const items: Array<{ mediaType: "movie" | "tv"; item: TmdbTrendingResult }> = [];
  for (const mediaType of ["movie", "tv"] as const) {
    for (const item of await trending(trimmedKey, mediaType)) {
      items.push({ mediaType, item });
    }
  }
  // The two lists are each already trend-ranked; sorting the merged list by
  // popularity is just a merge heuristic to interleave them sensibly.
  items.sort((a, b) => (b.item.popularity ?? 0) - (a.item.popularity ?? 0));

  const itemsWithProviders: Array<{
    item: TmdbTrendingResult;
    providerIds: number[];
  }> = [];
  for (const { mediaType, item } of items) {
    const providerIds = await fetchWatchProviderIds(trimmedKey, mediaType, item.id);
    itemsWithProviders.push({ item, providerIds });
  }

  for (const [tileId, providerId] of Object.entries(TMDB_PROVIDERS)) {
    const matches = itemsWithProviders
      .filter(({ providerIds }) => providerIds.includes(providerId))
      .map(({ item }) => item);
    if (matches.length === 0) continue;

    const backdropPath = matches.find((r) => r.backdrop_path)?.backdrop_path;
    if (!backdropPath) continue;

    const titles = matches
      .map(displayTitle)
      .filter((t): t is string => Boolean(t))
      .slice(0, MAX_TITLES_PER_TILE);

    catalog[tileId] = { titles, backdrop_url: `${TMDB_IMAGE_BASE}${backdropPath}` };
  }
  return catalog;
}
