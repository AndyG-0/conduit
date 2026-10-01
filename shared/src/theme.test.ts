import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTheme } from "./theme.js";

function mockMatchMedia(matches: boolean): void {
  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  // This suite runs under vitest's default `node` environment (no `window`
  // global at all, unlike a browser/jsdom), so `window` itself needs
  // stubbing, not just `matchMedia` on it.
  vi.stubGlobal("window", { matchMedia });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("resolves 'light' to light regardless of OS preference", () => {
    mockMatchMedia(true);
    expect(resolveTheme("light")).toBe("light");
  });

  it("resolves 'dark' to dark regardless of OS preference", () => {
    mockMatchMedia(false);
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves 'system' to dark when the OS prefers dark", () => {
    mockMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("resolves 'system' to light when the OS does not prefer dark", () => {
    mockMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });
});
