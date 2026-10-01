import { safeFetch } from "./http-fetch.js";

/**
 * Finds the best `<link rel="...icon...">` href in an HTML document. Prefers
 * a plain `icon`/`shortcut icon` over `apple-touch-icon` (usually a large
 * app-icon PNG, fine as a last resort but not the first choice for a small
 * tile badge) — many self-hosted apps (e.g. Jellyfin) only declare their
 * favicon this way, at a hashed/cache-busted filename that isn't at a
 * predictable path like `/favicon.ico`.
 *
 * Ported from `find_icon_href` in `src-tauri/src/favicon.rs`.
 */
export function findIconHref(html: string): string | null {
  const linkRe = /<link\s+[^>]*>/gis;
  const relDq = /\brel\s*=\s*"([^"]*)"/is;
  const relSq = /\brel\s*=\s*'([^']*)'/is;
  const hrefDq = /\bhref\s*=\s*"([^"]*)"/is;
  const hrefSq = /\bhref\s*=\s*'([^']*)'/is;

  const attr = (tag: string, dq: RegExp, sq: RegExp): string | null =>
    (dq.exec(tag) ?? sq.exec(tag))?.[1] ?? null;

  let appleTouchFallback: string | null = null;
  for (const match of html.matchAll(linkRe)) {
    const tag = match[0];
    const rel = attr(tag, relDq, relSq)?.toLowerCase();
    if (!rel || !rel.includes("icon")) continue;
    const href = attr(tag, hrefDq, hrefSq);
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) {
      appleTouchFallback ??= href;
      continue;
    }
    return href;
  }
  return appleTouchFallback;
}

export interface FaviconResult {
  contentType: string;
  body: Buffer;
}

/**
 * Best-effort favicon fetch for tile icons, run server-side rather than
 * through the browser's own `<img>` loading pipeline — same rationale as
 * `fetch_favicon` in `src-tauri/src/favicon.rs`: `web/src/icons.ts` tries a
 * direct in-page `<img src>` first and only calls this (via
 * `/api/proxy/favicon`) if that fails, which happens for a plain-HTTP local
 * network device (e.g. a homelab dashboard) — the PWA's own origin is HTTPS,
 * so that image load is mixed content and gets silently blocked by the
 * browser.
 *
 * `/favicon.ico` at the site root is tried first; on failure, falls back to
 * fetching the page itself and parsing its `<link rel="icon">` tags,
 * resolving a relative href against the page's *final* URL (post-redirect).
 * Returns `null` on any failure — callers should treat that as "no favicon
 * available", not surface an error.
 */
export async function fetchFavicon(
  baseUrl: string,
): Promise<FaviconResult | null> {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }

  try {
    const direct = new URL("/favicon.ico", base);
    const result = await safeFetch(direct.toString());
    if (result.status >= 200 && result.status < 300 && result.body.length > 0) {
      return {
        contentType: result.contentType || "image/x-icon",
        body: result.body,
      };
    }
  } catch {
    // Fall through to the HTML-scraping path below.
  }

  try {
    const page = await safeFetch(base.toString());
    if (page.status < 200 || page.status >= 300) return null;
    const html = page.body.toString("utf8");
    const href = findIconHref(html);
    if (!href) return null;

    if (href.startsWith("data:")) {
      const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(href);
      if (!match) return null;
      const [, mime, isBase64, data] = match;
      const body = isBase64
        ? Buffer.from(data ?? "", "base64")
        : Buffer.from(decodeURIComponent(data ?? ""), "utf8");
      return { contentType: mime || "image/x-icon", body };
    }

    const iconUrl = new URL(href, page.finalUrl);
    const iconResult = await safeFetch(iconUrl.toString());
    if (iconResult.status < 200 || iconResult.status >= 300) return null;
    return {
      contentType: iconResult.contentType || "image/x-icon",
      body: iconResult.body,
    };
  } catch {
    return null;
  }
}
