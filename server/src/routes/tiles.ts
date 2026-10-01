import { Router } from "express";
import type { AppTileInput } from "@conduit/shared";
import type { Registry } from "../lib/registry.js";
import { saveSecrets, type SecretsFile } from "../lib/secrets.js";

function readInput(body: unknown): AppTileInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    name: String(b.name ?? ""),
    base_url: String(b.base_url ?? ""),
    icon_slug: b.icon_slug ? String(b.icon_slug) : null,
  };
}

export function createTilesRouter(
  dataDir: string,
  registry: Registry,
  secrets: SecretsFile,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(registry.list());
  });

  router.post("/", (req, res) => {
    try {
      const tile = registry.add(readInput(req.body));
      res.status(201).json(tile);
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message) });
    }
  });

  router.post("/reorder", (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      registry.reorder(ids);
      res.status(204).end();
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message) });
    }
  });

  router.put("/:id/jellyfin-key", (req, res) => {
    const { id } = req.params;
    if (!registry.get(id)) {
      res.status(404).json({ error: `no tile with id ${id}` });
      return;
    }
    const apiKey = req.body?.apiKey ? String(req.body.apiKey).trim() : "";
    if (apiKey) {
      secrets.jellyfin[id] = apiKey;
    } else {
      delete secrets.jellyfin[id];
    }
    saveSecrets(dataDir, secrets);
    res.status(204).end();
  });

  router.put("/:id", (req, res) => {
    try {
      const tile = registry.update(req.params.id, readInput(req.body));
      res.json(tile);
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message) });
    }
  });

  router.delete("/:id", (req, res) => {
    const { id } = req.params;
    try {
      registry.remove(id);
      delete secrets.jellyfin[id];
      saveSecrets(dataDir, secrets);
      res.status(204).end();
    } catch (err) {
      res.status(404).json({ error: String((err as Error).message) });
    }
  });

  return router;
}
