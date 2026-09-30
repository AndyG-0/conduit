import { Router } from "express";
import type { Registry } from "../lib/registry.js";
import type { SecretsFile } from "../lib/secrets.js";
import { fetchFavicon } from "../lib/favicon.js";
import { fetchTrendingCatalog } from "../lib/tmdb.js";
import { fetchJellyfinBanner } from "../lib/jellyfin-banner.js";

/**
 * Proxy endpoints that fetch third-party data server-side so the browser
 * never makes the request directly — either because the target is
 * mixed-content (plain-HTTP LAN devices behind an HTTPS PWA origin) or
 * because it needs a secret (TMDB/Jellyfin API keys) that must never reach
 * the client.
 */
export function createProxyRouter(registry: Registry, secrets: SecretsFile): Router {
  const router = Router();

  router.get("/favicon", async (req, res) => {
    const tileId = typeof req.query.tileId === "string" ? req.query.tileId : "";
    const tile = tileId ? registry.get(tileId) : undefined;
    if (!tile) {
      res.status(404).json({ error: "unknown tile" });
      return;
    }

    const favicon = await fetchFavicon(tile.base_url);
    if (!favicon) {
      res.status(404).json({ error: "no favicon found" });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=86400");
    res.type(favicon.contentType || "application/octet-stream");
    res.send(favicon.body);
  });

  router.get("/trending", async (_req, res) => {
    if (!secrets.tmdbApiKey) {
      res.json({});
      return;
    }
    res.json(await fetchTrendingCatalog(secrets.tmdbApiKey));
  });

  router.get("/jellyfin/:tileId", async (req, res) => {
    const { tileId } = req.params;
    const tile = registry.get(tileId);
    if (!tile) {
      res.status(404).json({ error: `no tile with id ${tileId}` });
      return;
    }

    const apiKey = secrets.jellyfin[tileId];
    if (!apiKey) {
      res.json(null);
      return;
    }

    res.json(await fetchJellyfinBanner(tile.base_url, apiKey));
  });

  return router;
}
