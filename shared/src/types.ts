/**
 * A single "app" tile in the launcher grid. Unlike the native app's
 * `AppTile` (see `src-tauri/src/app_config.rs`), there is no `allowed_domains`
 * field — the PWA does same-tab navigation with no per-tile domain
 * confinement to enforce, so keeping it as inert display metadata would
 * mislead users into thinking navigation is still restricted.
 */
export interface AppTile {
  id: string;
  name: string;
  base_url: string;
  icon_slug: string | null;
}

/**
 * What the server actually returns from `GET /api/tiles` and friends.
 * `jellyfin_api_key_set` tells the settings UI whether to show "key saved"
 * vs. a blank field, without ever round-tripping the key itself back to the
 * browser.
 */
export interface AppTileView extends AppTile {
  jellyfin_api_key_set: boolean;
}

export interface AppTileInput {
  name: string;
  base_url: string;
  icon_slug: string | null;
}

export type ThemeSetting = "light" | "dark" | "system";

export interface Preferences {
  screensaver_enabled: boolean;
  theme: ThemeSetting;
  /** Whether a TMDB API key is stored server-side — see `routes/preferences.ts`. */
  tmdb_api_key_set: boolean;
}

/** Trending titles + backdrop art for one tile, fetched (server-side) from
 * TMDB — see `src/trending.ts` in the native app for the client-side
 * consumer this mirrors. */
export interface TrendingBanner {
  titles: string[];
  backdrop_url: string;
}

export interface AerialVideo {
  name: string;
  url: string;
}

/** Whether the browser currently holds a valid session cookie. */
export interface AuthStatus {
  authenticated: boolean;
  /** True only on a fresh server with no passphrase set yet — the frontend
   * uses this to show a "set a passphrase" form instead of a login form. */
  needsSetup: boolean;
}
