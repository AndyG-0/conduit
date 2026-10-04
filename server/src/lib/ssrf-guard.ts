import net from "node:net";

/**
 * Validates a proxy target's *resolved* IP, not just the hostname string —
 * checking the hostname alone would be trivially bypassed by DNS rebinding
 * (a name that resolves to an allowed IP at check time, then a blocked one
 * at fetch time, or vice versa).
 *
 * This is a self-hosted homelab product: Jellyfin and other custom tiles
 * routinely point at `192.168.x.x`/`10.x.x.x`, so RFC1918 (and IPv6 ULA) are
 * **allowed**, not blocked — a blanket "block all private IPs" rule would
 * break the exact use case this proxy exists for. Only **blocked**:
 * loopback (no legitimate tile ever targets the proxy's own host) and
 * link-local, which includes the `169.254.169.254` cloud-metadata address.
 */

function isIPv4Loopback(ip: string): boolean {
  return ip.startsWith("127.");
}

function isIPv4LinkLocal(ip: string): boolean {
  return ip.startsWith("169.254.");
}

/** Expands an IPv6 address's leading hextet range check for `fe80::/10`
 * (link-local): the first 10 bits must be `1111111010`, i.e. the first
 * hextet is in `0xfe80`-`0xfebf`. */
function isIPv6LinkLocal(ip: string): boolean {
  const first = ip.split(":")[0]?.toLowerCase() ?? "";
  if (!first) return false;
  const value = parseInt(first, 16);
  if (Number.isNaN(value)) return false;
  return value >= 0xfe80 && value <= 0xfebf;
}

function isIPv6Loopback(ip: string): boolean {
  return ip === "::1";
}

/** Extracts the embedded IPv4 address from an IPv4-mapped (`::ffff:a.b.c.d`)
 * or IPv4-compatible (`::a.b.c.d`) IPv6 address, so it can be checked with
 * the IPv4 rules instead of silently passing the IPv6 checks. */
function extractMappedIPv4(ip: string): string | null {
  const match = /^::(ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (!match) return null;
  const candidate = match[2];
  return net.isIP(candidate) === 4 ? candidate : null;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/** Checks a single resolved IP address against the block rules above. */
export function checkResolvedIp(ip: string): GuardResult {
  const version = net.isIP(ip);
  if (version === 4) {
    if (isIPv4Loopback(ip))
      return { allowed: false, reason: "loopback address" };
    if (isIPv4LinkLocal(ip))
      return { allowed: false, reason: "link-local address" };
    return { allowed: true };
  }
  if (version === 6) {
    const mapped = extractMappedIPv4(ip);
    if (mapped) return checkResolvedIp(mapped);
    if (isIPv6Loopback(ip))
      return { allowed: false, reason: "loopback address" };
    if (isIPv6LinkLocal(ip))
      return { allowed: false, reason: "link-local address" };
    return { allowed: true };
  }
  return { allowed: false, reason: "not a valid IP address" };
}

/** Checks a candidate proxy target URL's scheme up front — non-`http(s)`
 * schemes (e.g. `file:`, `ftp:`) are rejected outright, before any DNS
 * resolution happens. */
export function checkUrlScheme(url: URL): GuardResult {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: `unsupported scheme: ${url.protocol}` };
  }
  return { allowed: true };
}
