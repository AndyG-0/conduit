import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TMDB_PROVIDERS, fetchTrendingCatalog } from "../../src/lib/tmdb.js";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("TMDB_PROVIDERS", () => {
  it("maps known seeded tiles to provider ids", () => {
    expect(TMDB_PROVIDERS.netflix).toBe(8);
    expect(TMDB_PROVIDERS.appletv).toBe(350);
  });

  it("has no mapping for live-TV/sports tiles", () => {
    expect(TMDB_PROVIDERS.espn).toBeUndefined();
    expect(TMDB_PROVIDERS.youtubetv).toBeUndefined();
  });
});

describe("fetchTrendingCatalog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty catalog when no key is given", async () => {
    const catalog = await fetchTrendingCatalog("  ");
    expect(catalog).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("builds a banner for a tile whose provider matches a trending title", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/trending/movie/week")) {
        return jsonResponse({
          results: [
            { id: 1, title: "A Movie", backdrop_path: "/a.jpg", popularity: 10 },
          ],
        });
      }
      if (url.includes("/trending/tv/week")) {
        return jsonResponse({ results: [] });
      }
      if (url.includes("/movie/1/watch/providers")) {
        return jsonResponse({
          results: { US: { flatrate: [{ provider_id: 8 }] } },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const catalog = await fetchTrendingCatalog("test-key");
    expect(catalog.netflix).toEqual({
      titles: ["A Movie"],
      backdrop_url: "https://image.tmdb.org/t/p/w1280/a.jpg",
    });
    expect(catalog.hulu).toBeUndefined();
  });

  it("excludes rent-only availability from provider matching", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/trending/movie/week")) {
        return jsonResponse({
          results: [
            { id: 1, title: "A Movie", backdrop_path: "/a.jpg", popularity: 10 },
          ],
        });
      }
      if (url.includes("/trending/tv/week")) {
        return jsonResponse({ results: [] });
      }
      if (url.includes("/watch/providers")) {
        return jsonResponse({
          results: { US: { rent: [{ provider_id: 8 }] } },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const catalog = await fetchTrendingCatalog("test-key");
    expect(catalog.netflix).toBeUndefined();
  });

  it("truncates titles to 5 per tile", async () => {
    const movieResults = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      title: `Movie ${i + 1}`,
      backdrop_path: `/movie${i + 1}.jpg`,
      popularity: 100 - i,
    }));

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/trending/movie/week")) {
        return jsonResponse({ results: movieResults });
      }
      if (url.includes("/trending/tv/week")) {
        return jsonResponse({ results: [] });
      }
      if (url.includes("/watch/providers")) {
        return jsonResponse({
          results: { US: { flatrate: [{ provider_id: 8 }] } },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const catalog = await fetchTrendingCatalog("test-key");
    expect(catalog.netflix?.titles).toHaveLength(5);
    expect(catalog.netflix?.titles[0]).toBe("Movie 1");
  });

  it("skips a tile when nothing trending is available on it", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/trending/")) return jsonResponse({ results: [] });
      throw new Error(`unexpected url: ${url}`);
    });

    const catalog = await fetchTrendingCatalog("test-key");
    expect(catalog).toEqual({});
  });

  it("returns an empty catalog when the trending request fails", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false));
    const catalog = await fetchTrendingCatalog("test-key");
    expect(catalog).toEqual({});
  });
});
