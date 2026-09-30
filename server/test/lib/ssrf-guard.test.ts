import { describe, expect, it } from "vitest";
import { checkResolvedIp, checkUrlScheme } from "../../src/lib/ssrf-guard.js";

describe("checkResolvedIp", () => {
  it("blocks IPv4 loopback", () => {
    expect(checkResolvedIp("127.0.0.1").allowed).toBe(false);
  });

  it("blocks IPv4 link-local, including the cloud-metadata address", () => {
    expect(checkResolvedIp("169.254.169.254").allowed).toBe(false);
    expect(checkResolvedIp("169.254.1.1").allowed).toBe(false);
  });

  it("blocks IPv6 loopback and link-local", () => {
    expect(checkResolvedIp("::1").allowed).toBe(false);
    expect(checkResolvedIp("fe80::1").allowed).toBe(false);
  });

  it("allows RFC1918 private ranges — homelab/Jellyfin tiles depend on this", () => {
    expect(checkResolvedIp("192.168.1.50").allowed).toBe(true);
    expect(checkResolvedIp("10.0.0.5").allowed).toBe(true);
    expect(checkResolvedIp("172.16.0.5").allowed).toBe(true);
  });

  it("allows IPv6 ULA", () => {
    expect(checkResolvedIp("fd12:3456:789a::1").allowed).toBe(true);
  });

  it("allows public IPs", () => {
    expect(checkResolvedIp("93.184.216.34").allowed).toBe(true);
  });

  it("rejects a non-IP string", () => {
    expect(checkResolvedIp("not-an-ip").allowed).toBe(false);
  });
});

describe("checkUrlScheme", () => {
  it("allows http and https", () => {
    expect(checkUrlScheme(new URL("http://example.com/")).allowed).toBe(true);
    expect(checkUrlScheme(new URL("https://example.com/")).allowed).toBe(
      true,
    );
  });

  it("rejects other schemes", () => {
    expect(checkUrlScheme(new URL("file:///etc/passwd")).allowed).toBe(false);
    expect(checkUrlScheme(new URL("ftp://example.com/")).allowed).toBe(false);
  });
});
