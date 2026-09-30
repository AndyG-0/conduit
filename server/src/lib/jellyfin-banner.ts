import type { TrendingBanner } from "@conduit/shared";
import { safeFetch } from "./http-fetch.js";

const JELLYFIN_FETCH_TIMEOUT_MS = 6000;
const MAX_TITLES_PER_TILE = 5;
/** Requested above `MAX_TITLES_PER_TILE` so there's a decent chance at least
 * one of the returned items actually has a backdrop image to use as the
 * banner's `backdrop_url` — some recently-added items (e.g. a lone episode)
 * don't carry one. */
const LATEST_FETCH_LIMIT = 12;

/** One entry from `GET /Users`. Unlike `/Items/Latest` below, this endpoint
 * serializes PascalCase (`"Id"`, not `"id"`) — Jellyfin isn't consistent
 * about it across endpoints, so each interface here matches what its own
 * endpoint actually sends rather than assuming a single convention. */
interface JellyfinUser {
  Id: string;
}

/** One entry from `GET /Items/Latest`. `BackdropImageTags` is an empty array
 * (not absent) when an item has no backdrop image of its own. */
interface JellyfinLatestItem {
  Id: string;
  Name?: string;
  BackdropImageTags?: string[];
}

/** A tile's `base_url` is what its webview actually navigates to — commonly
 * something like `http://host:8096/web/#/home`, the SPA route, not the
 * server root. Jellyfin's REST API is mounted at the server root
 * (`/Users`, `/Items/Latest`, ...), so every API call needs just the
 * scheme+host+port with the path/query/fragment stripped off. Returns `null`
 * for a URL that doesn't even parse. Ported from `api_root` in
 * `src-tauri/src/jellyfin.rs`. */
function apiRoot(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

async function fetchJellyfinJson<T>(
  url: string,
  apiKey: string,
): Promise<T | null> {
  try {
    const result = await safeFetch(url, {
      timeoutMs: JELLYFIN_FETCH_TIMEOUT_MS,
      headers: { "X-Emby-Token": apiKey },
    });
    if (result.status < 200 || result.status >= 300) return null;
    return JSON.parse(result.body.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** A server-wide Jellyfin API key isn't bound to a user (unlike a per-user
 * login token), but `/Items/Latest` needs a `userId` — this is only ever
 * used to pick *a* library-visible account for a decorative banner, not for
 * any access-control decision, so grabbing the first one back is an
 * acceptable heuristic for the common single-user self-hosted case. */
async function fetchFirstUserId(
  base: string,
  apiKey: string,
): Promise<string | null> {
  const users = await fetchJellyfinJson<JellyfinUser[]>(`${base}/Users`, apiKey);
  return users?.[0]?.Id ?? null;
}

/** Fetches recently-added items across every library the looked-up user can
 * see. Omitting `parentId` is deliberate, not an oversight — Jellyfin's own
 * `/Items/Latest` handler falls back to the user's full library-view list
 * when no parent is given, so this needs no per-tile "which library" setup. */
async function fetchLatestItems(
  base: string,
  apiKey: string,
  userId: string,
): Promise<JellyfinLatestItem[]> {
  const url = new URL(`${base}/Items/Latest`);
  url.searchParams.set("userId", userId);
  url.searchParams.set("limit", String(LATEST_FETCH_LIMIT));
  const items = await fetchJellyfinJson<JellyfinLatestItem[]>(
    url.toString(),
    apiKey,
  );
  return items ?? [];
}

function firstBackdropItem(
  items: JellyfinLatestItem[],
): JellyfinLatestItem | undefined {
  return items.find((item) => (item.BackdropImageTags?.length ?? 0) > 0);
}

/** Auth via an `?ApiKey=` query param rather than the `X-Emby-Token` header
 * the JSON calls above use — this URL is handed straight to an `<img src>`
 * on the frontend, which can't attach a custom header. */
function imageUrl(base: string, itemId: string, apiKey: string): string {
  const url = new URL(`${base}/Items/${itemId}/Images/Backdrop`);
  url.searchParams.set("maxWidth", "1280");
  url.searchParams.set("quality", "90");
  url.searchParams.set("ApiKey", apiKey);
  return url.toString();
}

/**
 * Fetches one tile's Jellyfin "recently added" artwork/titles for the hero
 * banner — the self-hosted counterpart to `tmdb.ts`'s `fetchTrendingCatalog`
 * for TMDB-covered tiles. Never throws: an unreachable server or a bad key
 * both just produce `null`. `baseUrl` is user-supplied and points at another
 * LAN host, so the HTTP calls go through `safeFetch` for SSRF protection —
 * unlike TMDB's fixed, trusted host. Ported from `fetch_jellyfin_banner` in
 * `src-tauri/src/jellyfin.rs`.
 */
export async function fetchJellyfinBanner(
  baseUrl: string,
  apiKey: string,
): Promise<TrendingBanner | null> {
  const base = apiRoot(baseUrl);
  if (!base) return null;
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) return null;

  const userId = await fetchFirstUserId(base, trimmedKey);
  if (!userId) return null;
  const items = await fetchLatestItems(base, trimmedKey, userId);

  const backdropItem = firstBackdropItem(items);
  if (!backdropItem) return null;

  const titles = items
    .map((item) => item.Name)
    .filter((n): n is string => Boolean(n))
    .slice(0, MAX_TITLES_PER_TILE);

  return {
    titles,
    backdrop_url: imageUrl(base, backdropItem.Id, trimmedKey),
  };
}
