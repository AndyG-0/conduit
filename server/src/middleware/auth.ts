import type { NextFunction, Request, Response } from "express";
import { COOKIE_NAME } from "../config.js";
import { verifySessionToken } from "../lib/session-auth.js";
import type { SecretsFile } from "../lib/secrets.js";

/** Shared by `requireAuth` and `GET /api/auth/status` so the definition of
 * "authenticated" never drifts between the two. */
export function hasValidSession(req: Request, secrets: SecretsFile): boolean {
  const token = req.cookies?.[COOKIE_NAME];
  return (
    typeof token === "string" &&
    verifySessionToken(token, secrets.sessionSigningKey)
  );
}

/**
 * Gates every `/api/*` route except `/api/auth/*` behind a valid session
 * cookie. Stateless: validity is entirely a function of the cookie's HMAC
 * signature and embedded expiry (see `lib/session-auth.ts`), so this never
 * touches disk.
 */
export function requireAuth(secrets: SecretsFile) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hasValidSession(req, secrets)) {
      next();
      return;
    }
    res.status(401).json({ error: "unauthenticated" });
  };
}
