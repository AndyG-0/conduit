import type { AppTileView, TrendingBanner } from "@conduit/shared";
import { proxyApi } from "./api-client";
import { setBannerFor } from "./trending";

/**
 * Fetches one tile's Jellyfin "recently added" banner and folds it into the
 * shared trending cache (`trending.ts`), so `main.ts`'s rendering path never
 * needs to know TMDB and Jellyfin are two different sources. Same
 * "unavailable this session" convention as TMDB: any failure — no key set,
 * unreachable server, bad key — is silent. Ported from `src/jellyfin.ts` in
 * the native app.
 */
export async function refreshJellyfinBanner(
  tile: AppTileView,
  onUpdate: () => void,
): Promise<void> {
  if (!tile.jellyfin_api_key_set) return;

  const banner: TrendingBanner | null = await proxyApi
    .jellyfinBanner(tile.id)
    .catch(() => null);
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
  tiles: AppTileView[],
  onUpdate: () => void,
): Promise<void> {
  await Promise.all(
    tiles
      .filter((tile) => tile.jellyfin_api_key_set)
      .map((tile) => refreshJellyfinBanner(tile, onUpdate)),
  );
}
