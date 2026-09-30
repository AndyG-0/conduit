import { Router } from "express";
import type { AuthStatus } from "@conduit/shared";
import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "../config.js";
import {
  createSessionToken,
  hashPassphrase,
  verifyPassphrase,
  verifySessionToken,
} from "../lib/session-auth.js";
import { saveSecrets, type SecretsFile } from "../lib/secrets.js";

function setSessionCookie(
  res: import("express").Response,
  req: import("express").Request,
  secrets: SecretsFile,
): void {
  const token = createSessionToken(
    secrets.sessionSigningKey,
    SESSION_MAX_AGE_MS,
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function createAuthRouter(dataDir: string, secrets: SecretsFile): Router {
  const router = Router();

  router.get("/status", (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    const status: AuthStatus = {
      authenticated:
        typeof token === "string" &&
        verifySessionToken(token, secrets.sessionSigningKey),
      needsSetup: !secrets.passphraseHash,
    };
    res.json(status);
  });

  router.post("/setup", (req, res) => {
    if (secrets.passphraseHash) {
      res.status(409).json({ error: "a passphrase is already set" });
      return;
    }
    const passphrase = String(req.body?.passphrase ?? "");
    if (passphrase.length < 8) {
      res
        .status(400)
        .json({ error: "passphrase must be at least 8 characters" });
      return;
    }
    const { hash, salt } = hashPassphrase(passphrase);
    secrets.passphraseHash = hash;
    secrets.passphraseSalt = salt;
    saveSecrets(dataDir, secrets);
    setSessionCookie(res, req, secrets);
    res.json({ authenticated: true, needsSetup: false } satisfies AuthStatus);
  });

  router.post("/login", (req, res) => {
    if (!secrets.passphraseHash || !secrets.passphraseSalt) {
      res.status(409).json({ error: "no passphrase set — run setup first" });
      return;
    }
    const passphrase = String(req.body?.passphrase ?? "");
    if (
      !verifyPassphrase(
        passphrase,
        secrets.passphraseHash,
        secrets.passphraseSalt,
      )
    ) {
      res.status(401).json({ error: "incorrect passphrase" });
      return;
    }
    setSessionCookie(res, req, secrets);
    res.json({ authenticated: true, needsSetup: false } satisfies AuthStatus);
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.status(204).end();
  });

  return router;
}
