import { Router } from "express";
import type { Registry } from "../lib/registry.js";
import { fetchFavicon } from "../lib/favicon.js";

/**
 * Proxy endpoints that fetch third-party data server-side so the browser
 * never makes the request directly — either because the target is
 * mixed-content (plain-HTTP LAN devices behind an HTTPS PWA origin) or
 * because it needs a secret (TMDB/Jellyfin API keys) that must never reach
 * the client.
 */
export function createProxyRouter(registry: Registry): Router {
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

  // TMDB trending banners and Jellyfin library data are Phase 5 stretch
  // work (screensaver/trending parity) — not required for MVP.
  router.get("/trending", (_req, res) => {
    res.status(501).json({ error: "not yet implemented" });
  });

  router.get("/jellyfin/:tileId", (_req, res) => {
    res.status(501).json({ error: "not yet implemented" });
  });

  return router;
}
