import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashPassphrase,
  verifyPassphrase,
  verifySessionToken,
} from "../../src/lib/session-auth.js";

describe("hashPassphrase / verifyPassphrase", () => {
  it("verifies a correct passphrase against its own hash", () => {
    const { hash, salt } = hashPassphrase("correct horse battery staple");
    expect(verifyPassphrase("correct horse battery staple", hash, salt)).toBe(
      true,
    );
  });

  it("rejects an incorrect passphrase", () => {
    const { hash, salt } = hashPassphrase("correct horse battery staple");
    expect(verifyPassphrase("wrong passphrase", hash, salt)).toBe(false);
  });

  it("produces a different salt each time", () => {
    const a = hashPassphrase("same passphrase");
    const b = hashPassphrase("same passphrase");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("createSessionToken / verifySessionToken", () => {
  const key = "a".repeat(64);

  it("verifies a freshly-created token", () => {
    const token = createSessionToken(key, 1000);
    expect(verifySessionToken(token, key)).toBe(true);
  });

  it("rejects a token signed with a different key", () => {
    const token = createSessionToken(key, 1000);
    expect(verifySessionToken(token, "b".repeat(64))).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken(key, 1000);
    const [, sig] = token.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ iat: 0, exp: 9999999999999 })).toString("base64url")}.${sig}`;
    expect(verifySessionToken(tampered, key)).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = Date.now();
    const token = createSessionToken(key, 1000, now - 5000);
    expect(verifySessionToken(token, key, now)).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(verifySessionToken("not-a-token", key)).toBe(false);
    expect(verifySessionToken("", key)).toBe(false);
  });
});
