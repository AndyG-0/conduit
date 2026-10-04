import { invoke } from "@tauri-apps/api/core";
import { escapeHtml } from "@conduit/shared";
import netflix from "./assets/logos/netflix.svg?raw";
import hbomax from "./assets/logos/hbomax.svg?raw";
import tubi from "./assets/logos/tubi.svg?raw";
import paramountplus from "./assets/logos/paramountplus.svg?raw";
import youtubetv from "./assets/logos/youtubetv.svg?raw";
import appletv from "./assets/logos/appletv.svg?raw";
import hulu from "./assets/logos/hulu.svg?raw";
import disneyplus from "./assets/logos/disney-plus.svg?raw";
import peacock from "./assets/logos/peacock.svg?raw";
import amazonprimevideo from "./assets/logos/amazon-prime-video.svg?raw";

/**
 * Real brand marks, keyed by the `icon_slug` a registry tile carries.
 * Sourced from `simple-icons` (CC0) where it has the mark, and from
 * selfhst/icons (CC-BY-4.0, attribution in NOTICE.md) for the rest — see
 * that file for per-icon sourcing. Vendored under `src/assets/logos/`.
 * ESPN and Sling TV aren't in either set; they use the monogram fallback
 * below until a legitimately-licensed mark turns up.
 */
const LOGOS: Record<string, string> = {
  netflix,
  hbomax,
  tubi,
  paramountplus,
  youtubetv,
  appletv,
  hulu,
  disneyplus,
  peacock,
  amazonprimevideo,
};

/**
 * These marks are a single hardcoded `fill="#000000"` — swapped for
 * `currentColor` so they repaint with the tile canvas instead of vanishing
 * against a dark background. Both are text logos, so it doesn't just do
 * this to `LOGOS` (fine on any solid page background); everything else
 * either isn't flat black (safe already) or has its blackness in an
 * unlabeled default fill or a nested `style="fill:..."` (harder to swap
 * safely) and is exception-listed onto a fixed canvas below instead.
 */
const MONO_RECOLOR_SLUGS = new Set(["appletv", "hbomax"]);
for (const slug of MONO_RECOLOR_SLUGS) {
  LOGOS[slug] = LOGOS[slug].split('fill="#000000"').join('fill="currentColor"');
}

/**
 * Marks whose black/near-black fill can't be safely swapped to
 * `currentColor` (Peacock's body path has no `fill` attribute at all;
 * Disney+'s wordmark color lives inside a `style="fill:..."` attribute) —
 * these stay on a fixed, never-themed light canvas instead, same as today.
 */
const FIXED_CANVAS_SLUGS = new Set(["disneyplus", "peacock"]);

/** Whether a tile icon needs a fixed light canvas rather than repainting
 * with the current theme (see `FIXED_CANVAS_SLUGS`). */
export function isFixedCanvasIcon(slug: string | null | undefined): boolean {
  return !!slug && FIXED_CANVAS_SLUGS.has(slug);
}

const MONOGRAM_COLORS = [
  "#e50914",
  "#1ce783",
  "#0064ff",
  "#7408ff",
  "#ff9900",
  "#00a8e1",
  "#d00a0a",
  "#113ccf",
];

export function monogramColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length];
}

/**
 * Generated monogram badge fallback: used for custom/unlisted services with
 * no vendored logo and no usable favicon, so every tile still gets a
 * distinct, consistent-looking icon.
 */
export function renderMonogram(
  slug: string | null | undefined,
  name: string,
): string {
  const letter = escapeHtml((name.trim()[0] ?? "?").toUpperCase());
  const color = monogramColor(name || slug || "?");
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="${color}"/><text x="12" y="17" text-anchor="middle" font-size="14" font-family="-apple-system, sans-serif" fill="#fff">${letter}</text></svg>`;
}

/**
 * The favicon URL to try for a tile's `base_url`, or `null` if `base_url`
 * doesn't parse. `/favicon.ico` at the site root resolves correctly for
 * every currently-seeded service; sites that only serve a favicon elsewhere
 * fall back to the monogram badge via `attachFaviconFallback`.
 */
export function faviconUrl(baseUrl: string): string | null {
  try {
    return new URL("/favicon.ico", baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Returns markup for a tile's icon, in order of precedence: the real brand
 * SVG when `slug` is a manually-chosen override we have vendored, then the
 * site's own favicon (fetched directly from its domain, not a third-party
 * proxy), then a generated monogram badge.
 *
 * The favicon case renders as an `<img>` with no inline error handler (the
 * markup here is inserted via `innerHTML`, and an inline `onerror=` would
 * both fight CSP and scatter fallback logic across call sites) — callers
 * must invoke `attachFaviconFallback` after inserting this markup into the
 * DOM so a broken favicon still downgrades to the monogram.
 */
export function renderTileIcon(
  slug: string | null | undefined,
  name: string,
  baseUrl?: string | null,
): string {
  if (slug && LOGOS[slug]) {
    return LOGOS[slug];
  }
  const favicon = baseUrl ? faviconUrl(baseUrl) : null;
  if (favicon) {
    return `<img class="tile-icon-favicon" src="${escapeHtml(favicon)}" alt="" />`;
  }
  return renderMonogram(slug, name);
}

/**
 * Wires up the fallback for a favicon `<img>` rendered by `renderTileIcon`:
 * if the direct in-page load fails, tries a Rust-side refetch (via the
 * `fetch_favicon` command) before giving up — the packaged app's window is a
 * secure origin, so a plain `http://` favicon (any local network device that
 * isn't serving TLS) is mixed content and gets silently blocked by the
 * webview itself; fetching it from Rust sidesteps that restriction. Only
 * then does it fall back to the monogram badge. No-op if `container` doesn't
 * contain a favicon image (override or monogram cases).
 */
export function attachFaviconFallback(
  container: Element,
  slug: string | null | undefined,
  name: string,
  baseUrl?: string | null,
): void {
  const img = container.querySelector<HTMLImageElement>(".tile-icon-favicon");
  if (!img) return;
  img.addEventListener(
    "error",
    () => {
      void (async () => {
        const refetched = baseUrl
          ? await invoke<string | null>("fetch_favicon", { baseUrl }).catch(
              () => null,
            )
          : null;
        if (refetched) {
          img.src = refetched;
        } else {
          img.outerHTML = renderMonogram(slug, name);
        }
      })();
    },
    { once: true },
  );
}

/** Known icon slugs, for the settings UI's icon override picker. */
export const KNOWN_ICON_SLUGS = Object.keys(LOGOS);
