import crypto from "node:crypto";

const SCRYPT_KEYLEN = 64;

/** Hashes a freshly-chosen passphrase for storage. Returns hex-encoded
 * `hash`/`salt` to persist in `secrets.json`. */
export function hashPassphrase(passphrase: string): {
  hash: string;
  salt: string;
} {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(passphrase, salt, SCRYPT_KEYLEN)
    .toString("hex");
  return { hash, salt };
}

/** Constant-time check of a login attempt against a stored hash/salt pair. */
export function verifyPassphrase(
  passphrase: string,
  hash: string,
  salt: string,
): boolean {
  const candidate = crypto.scryptSync(passphrase, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

interface SessionPayload {
  iat: number;
  exp: number;
}

/**
 * A stateless, signed session token: `base64url(payload).base64url(hmac)`.
 * No server-side session table — there's one shared passphrase, not
 * accounts, so validity is entirely a function of the signature and the
 * embedded expiry. Rotating `signingKey` (a fresh server install, or a
 * deliberate "log out everywhere") invalidates every outstanding token at
 * once.
 */
export function createSessionToken(
  signingKey: string,
  maxAgeMs: number,
  now: number = Date.now(),
): string {
  const payload: SessionPayload = { iat: now, exp: now + maxAgeMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", Buffer.from(signingKey, "hex"))
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

/** Verifies a token's signature and that it hasn't expired. */
export function verifySessionToken(
  token: string,
  signingKey: string,
  now: number = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts as [string, string];

  const expectedSig = crypto
    .createHmac("sha256", Buffer.from(signingKey, "hex"))
    .update(payloadB64)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return false;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as SessionPayload;
  } catch {
    return false;
  }
  return typeof payload.exp === "number" && now < payload.exp;
}
