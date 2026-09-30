import type { NextFunction, Request, Response } from "express";
import { COOKIE_NAME } from "../config.js";
import { verifySessionToken } from "../lib/session-auth.js";
import type { SecretsFile } from "../lib/secrets.js";

/**
 * Gates every `/api/*` route except `/api/auth/*` behind a valid session
 * cookie. Stateless: validity is entirely a function of the cookie's HMAC
 * signature and embedded expiry (see `lib/session-auth.ts`), so this never
 * touches disk.
 */
export function requireAuth(secrets: SecretsFile) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.[COOKIE_NAME];
    if (
      typeof token === "string" &&
      verifySessionToken(token, secrets.sessionSigningKey)
    ) {
      next();
      return;
    }
    res.status(401).json({ error: "unauthenticated" });
  };
}
