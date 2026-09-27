import type { ThemeSetting } from "./types";

const CACHE_KEY = "conduit-theme-resolved";

export type ResolvedTheme = "light" | "dark";

/** Pure: resolves a user-facing theme setting to the actual light/dark value
 * to paint, reading the OS preference only for `"system"`. */
export function resolveTheme(setting: ThemeSetting): ResolvedTheme {
  if (setting === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return setting;
}

function paint(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(CACHE_KEY, resolved);
  } catch {
    // Best-effort cache only — ignore quota/availability errors.
  }
}

/** Applies whatever resolved theme was cached from a previous run, before
 * the authoritative `get_preferences` round trip resolves, so there's no
 * flash of the wrong theme on launch. */
export function applyCachedTheme(): void {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    // Ignore — fall back to the default below.
  }
  document.documentElement.dataset.theme =
    cached === "light" || cached === "dark" ? cached : "dark";
}

let mediaQuery: MediaQueryList | null = null;
let mediaQueryListener: (() => void) | null = null;

/** Resolves and paints `setting`, and — for `"system"` — keeps repainting
 * live as the OS preference changes while it stays selected. Safe to call
 * repeatedly (e.g. each time the setting changes in Settings). */
export function applyTheme(setting: ThemeSetting): void {
  paint(resolveTheme(setting));

  if (mediaQuery && mediaQueryListener) {
    mediaQuery.removeEventListener("change", mediaQueryListener);
    mediaQuery = null;
    mediaQueryListener = null;
  }

  if (setting === "system") {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQueryListener = () => paint(resolveTheme(setting));
    mediaQuery.addEventListener("change", mediaQueryListener);
  }
}
