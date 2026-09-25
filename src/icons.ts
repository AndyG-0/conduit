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

function monogramColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length];
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

/**
 * Returns markup for a tile's icon: the real brand SVG when `slug` is one
 * we have vendored, otherwise a generated monogram badge so custom/unlisted
 * services added through Settings still get a distinct, consistent-looking
 * tile.
 */
export function renderTileIcon(
  slug: string | null | undefined,
  name: string,
): string {
  if (slug && LOGOS[slug]) {
    return LOGOS[slug];
  }
  const letter = escapeHtml((name.trim()[0] ?? "?").toUpperCase());
  const color = monogramColor(name || slug || "?");
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="${color}"/><text x="12" y="17" text-anchor="middle" font-size="14" font-family="-apple-system, sans-serif" fill="#fff">${letter}</text></svg>`;
}

/** Known icon slugs, for the settings UI's icon picker. */
export const KNOWN_ICON_SLUGS = Object.keys(LOGOS);
