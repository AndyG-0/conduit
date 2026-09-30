import dns from "node:dns/promises";
import { checkResolvedIp, checkUrlScheme } from "./ssrf-guard.js";

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class SsrfBlockedError extends Error {}

/**
 * Resolves `url`'s hostname and rejects if any resolved address fails the
 * ssrf-guard checks. Every resolved address is checked, not just the first
 * — a hostname round-robining between an allowed and a blocked address
 * would otherwise slip through on a lucky resolution order.
 */
async function assertSafeTarget(url: URL): Promise<void> {
  const schemeCheck = checkUrlScheme(url);
  if (!schemeCheck.allowed) {
    throw new SsrfBlockedError(schemeCheck.reason ?? "blocked scheme");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw new SsrfBlockedError(`could not resolve host: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`could not resolve host: ${hostname}`);
  }
  for (const address of addresses) {
    const result = checkResolvedIp(address);
    if (!result.allowed) {
      throw new SsrfBlockedError(
        `blocked target ${hostname} (${address}): ${result.reason}`,
      );
    }
  }
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
}

/** A `fetch` wrapper safe to point at a user-supplied URL: validates the
 * resolved target against the ssrf-guard, applies a request timeout, and
 * caps the response body size. */
export async function safeFetch(
  targetUrl: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<SafeFetchResult> {
  const url = new URL(targetUrl);
  await assertSafeTarget(url);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: options.headers,
    });

    // A redirect could land on a different host than the one just checked
    // — re-validate the final URL's target before trusting the body.
    const finalUrl = new URL(response.url || url.toString());
    if (finalUrl.hostname !== url.hostname) {
      await assertSafeTarget(finalUrl);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error("response exceeded size limit");
        }
        chunks.push(value);
      }
    }
    return {
      status: response.status,
      contentType,
      body: Buffer.concat(chunks),
      finalUrl: finalUrl.toString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
