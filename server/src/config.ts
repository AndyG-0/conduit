import path from "node:path";

/**
 * Where `registry.json`/`secrets.json` live. Defaults to `./data` relative
 * to the process cwd (fine for local dev); the Docker image sets this to a
 * mounted volume path so state survives a container recreate.
 */
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");

export const PORT = Number(process.env.PORT ?? 8080);

/** Where `web/`'s built static assets are served from. */
export const WEB_DIST_DIR = path.resolve(
  process.env.WEB_DIST_DIR ?? "../web/dist",
);

/** Session cookie lifetime — long, deliberately: a "press Back to return to
 * the grid" flow that occasionally dumps the user at a login screen would be
 * a much worse regression than it looks. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const COOKIE_NAME = "conduit_session";
