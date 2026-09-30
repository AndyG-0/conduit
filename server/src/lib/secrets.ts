import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Every secret Conduit's server holds — the shared-passphrase hash, the
 * session-signing key, the optional global TMDB key, and per-tile Jellyfin
 * keys — lives in one plaintext-on-disk JSON file, `0600` permissions.
 *
 * This is deliberately **not encrypted at rest**: unlike the native app,
 * which has a real OS keychain to defer to, a self-hosted server has no
 * equivalent to hand secrets off to, and any key this process used to
 * encrypt the file would itself have to live somewhere readable by the same
 * process — which doesn't actually solve anything, just relocates the
 * problem. The accepted threat model is the same one `registry.json`
 * already has in the native app: a LAN-only deployment gated by the shared
 * passphrase, where anyone who can read this file already has filesystem
 * access to the host.
 */
export interface SecretsFile {
  /** scrypt hash of the shared passphrase, hex-encoded. Absent until first
   * run's setup step. */
  passphraseHash?: string;
  /** scrypt salt, hex-encoded. */
  passphraseSalt?: string;
  /** HMAC-SHA256 key used to sign session cookies, hex-encoded. Generated
   * once on first run; rotating it invalidates every outstanding session. */
  sessionSigningKey: string;
  tmdbApiKey?: string;
  /** Per-tile Jellyfin API keys, keyed by tile id. */
  jellyfin: Record<string, string>;
}

function secretsPath(dataDir: string): string {
  return path.join(dataDir, "secrets.json");
}

function defaultSecrets(): SecretsFile {
  return {
    sessionSigningKey: crypto.randomBytes(32).toString("hex"),
    jellyfin: {},
  };
}

export function loadSecrets(dataDir: string): SecretsFile {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = secretsPath(dataDir);
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(contents) as Partial<SecretsFile>;
    return {
      passphraseHash: parsed.passphraseHash,
      passphraseSalt: parsed.passphraseSalt,
      sessionSigningKey: parsed.sessionSigningKey ?? crypto.randomBytes(32).toString("hex"),
      tmdbApiKey: parsed.tmdbApiKey,
      jellyfin: parsed.jellyfin ?? {},
    };
  } catch {
    const fresh = defaultSecrets();
    saveSecrets(dataDir, fresh);
    return fresh;
  }
}

export function saveSecrets(dataDir: string, secrets: SecretsFile): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = secretsPath(dataDir);
  fs.writeFileSync(filePath, JSON.stringify(secrets, null, 2), {
    mode: 0o600,
  });
  // `writeFileSync`'s `mode` only applies when the file is created; force it
  // on every save in case the file already existed with looser permissions
  // (e.g. copied in from elsewhere).
  fs.chmodSync(filePath, 0o600);
}
