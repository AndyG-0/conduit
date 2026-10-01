import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { DATA_DIR, WEB_DIST_DIR } from "./config.js";
import { loadSecrets } from "./lib/secrets.js";
import { Registry } from "./lib/registry.js";
import { PreferencesStore } from "./lib/preferences.js";
import { requireAuth } from "./middleware/auth.js";
import { createAuthRouter } from "./routes/auth.js";
import { createTilesRouter } from "./routes/tiles.js";
import { createPreferencesRouter } from "./routes/preferences.js";
import { createProxyRouter } from "./routes/proxy.js";

/**
 * Builds the Express app without binding a port, so tests can exercise it
 * directly via `supertest` against an isolated `dataDir`.
 */
export function createApp(dataDir: string = DATA_DIR): Express {
  const secrets = loadSecrets(dataDir);
  const registry = Registry.load(dataDir, secrets);
  const preferences = PreferencesStore.load(dataDir, secrets);

  const app = express();
  app.disable("x-powered-by");
  // The documented deployment (Caddyfile) terminates TLS and reverse-proxies
  // to this server over plain HTTP on the same Docker network — exactly one
  // hop. Without this, `req.secure` is always false behind that proxy and
  // the session cookie never gets the `Secure` attribute (see setSessionCookie).
  app.set("trust proxy", 1);
  app.use(
    helmet({
      // The proxy endpoints return third-party images with their own
      // content-type; a strict default-src CSP would only fight the SPA's
      // own inline bootstrap with no security benefit for a LAN-only,
      // single-tenant app.
      contentSecurityPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());

  app.use("/api/auth", createAuthRouter(dataDir, secrets));
  app.use(
    "/api/tiles",
    requireAuth(secrets),
    createTilesRouter(dataDir, registry, secrets),
  );
  app.use(
    "/api/preferences",
    requireAuth(secrets),
    createPreferencesRouter(dataDir, preferences, secrets),
  );
  app.use(
    "/api/proxy",
    requireAuth(secrets),
    createProxyRouter(registry, secrets),
  );

  if (fs.existsSync(WEB_DIST_DIR)) {
    app.use(express.static(WEB_DIST_DIR));
    // Express 5's router requires wildcards to be named (`/*splat`) rather
    // than a bare `*` — this matches every non-API path for SPA fallback.
    app.get("/*splat", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(path.join(WEB_DIST_DIR, "index.html"));
    });
  }

  return app;
}
