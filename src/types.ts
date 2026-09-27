export interface AppTile {
  id: string;
  name: string;
  base_url: string;
  allowed_domains: string[];
  icon_slug: string | null;
  /** Whether a Jellyfin API key is stored in the OS keychain for this tile
   * — the key itself never round-trips to the frontend, see
   * `jellyfin::set_jellyfin_api_key`. */
  jellyfin_api_key_set: boolean;
}

export interface AppTileInput {
  name: string;
  base_url: string;
  allowed_domains: string[];
  icon_slug: string | null;
}

export type ThemeSetting = "light" | "dark" | "system";

export interface Preferences {
  screensaver_enabled: boolean;
  theme: ThemeSetting;
  /** Whether a TMDB API key is stored in the OS keychain — see
   * `preferences::set_tmdb_api_key`. */
  tmdb_api_key_set: boolean;
}

/** Trending titles + backdrop art for one tile, fetched from TMDB — see
 * `src/trending.ts`. */
export interface TrendingBanner {
  titles: string[];
  backdrop_url: string;
}

export interface AerialVideo {
  name: string;
  url: string;
}
