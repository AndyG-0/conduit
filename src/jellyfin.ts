import { invoke } from "@tauri-apps/api/core";
import { setBannerFor } from "./trending";
import type { AppTile, TrendingBanner } from "./types";

/**
 * Fetches one tile's Jellyfin "recently added" banner and folds it into the
 * shared trending cache (`trending.ts`), so `main.ts`'s rendering path never
 * needs to know TMDB and Jellyfin are two different sources. Same
 * "unavailable this session" convention as TMDB: any failure — no key set,
 * unreachable server, bad key — is silent.
 */
export async function refreshJellyfinBanner(
  tile: AppTile,
  onUpdate: () => void,
): Promise<void> {
  if (!tile.jellyfin_api_key_set) return;

  const banner = await invoke<TrendingBanner | null>("fetch_jellyfin_banner", {
    tileId: tile.id,
    baseUrl: tile.base_url,
  }).catch(() => null);
  if (!banner) return;

  setBannerFor(tile.id, banner);
  onUpdate();
}

/**
 * Called once per session for every tile that has a Jellyfin key configured.
 * Unlike TMDB there's no single global catalog fetch here — each Jellyfin
 * tile points at its own self-hosted server, so every configured tile gets
 * its own request.
 */
export async function refreshAllJellyfinBanners(
  tiles: AppTile[],
  onUpdate: () => void,
): Promise<void> {
  await Promise.all(
    tiles
      .filter((tile) => tile.jellyfin_api_key_set)
      .map((tile) => refreshJellyfinBanner(tile, onUpdate)),
  );
}
