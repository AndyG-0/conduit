import { Router } from "express";
import type { ThemeSetting } from "@conduit/shared";
import { PreferencesStore } from "../lib/preferences.js";
import { saveSecrets, type SecretsFile } from "../lib/secrets.js";

const VALID_THEMES: ThemeSetting[] = ["light", "dark", "system"];

export function createPreferencesRouter(
  dataDir: string,
  preferences: PreferencesStore,
  secrets: SecretsFile,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(preferences.view());
  });

  router.put("/screensaver", (req, res) => {
    res.json(preferences.setScreensaverEnabled(Boolean(req.body?.enabled)));
  });

  router.put("/theme", (req, res) => {
    const theme = req.body?.theme;
    if (!VALID_THEMES.includes(theme)) {
      res.status(400).json({ error: "invalid theme" });
      return;
    }
    res.json(preferences.setTheme(theme));
  });

  router.put("/tmdb-key", (req, res) => {
    const apiKey = req.body?.apiKey ? String(req.body.apiKey).trim() : "";
    if (apiKey) {
      secrets.tmdbApiKey = apiKey;
    } else {
      delete secrets.tmdbApiKey;
    }
    saveSecrets(dataDir, secrets);
    res.json(preferences.view());
  });

  return router;
}
