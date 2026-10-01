import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeFetchResult } from "../../src/lib/http-fetch.js";

vi.mock("../../src/lib/http-fetch.js", () => ({
  safeFetch: vi.fn(),
}));

const { TMDB_PROVIDERS, fetchTrendingCatalog } = await import(
  "../../src/lib/tmdb.js"
);
const { safeFetch } = await import("../../src/lib/http-fetch.js");

function jsonResult(body: unknown, status = 200): SafeFetchResult {
  return {
    status,
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(body)),
    finalUrl: "https://api.themoviedb.org/3/mock",
  };
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
    vi.resetAllMocks();
  });

  it("returns an empty catalog when no key is given", async () => {
    const catalog = await fetchTrendingCatalog("  ");
    expect(catalog).toEqual({});
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("builds a banner for a tile whose provider matches a trending title", async () => {
    vi.mocked(safeFetch).mockImplementation(async (url) => {
      if (url.includes("/trending/movie/week")) {
        return jsonResult({
          results: [
            { id: 1, title: "A Movie", backdrop_path: "/a.jpg", popularity: 10 },
          ],
        });
      }
      if (url.includes("/trending/tv/week")) {
        return jsonResult({ results: [] });
      }
      if (url.includes("/movie/1/watch/providers")) {
        return jsonResult({
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
    vi.mocked(safeFetch).mockImplementation(async (url) => {
      if (url.includes("/trending/movie/week")) {
        return jsonResult({
          results: [
            { id: 1, title: "A Movie", backdrop_path: "/a.jpg", popularity: 10 },
          ],
        });
      }
      if (url.includes("/trending/tv/week")) {
        return jsonResult({ results: [] });
      }
      if (url.includes("/watch/providers")) {
        return jsonResult({
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

    vi.mocked(safeFetch).mockImplementation(async (url) => {
      if (url.includes("/trending/movie/week")) {
        return jsonResult({ results: movieResults });
      }
      if (url.includes("/trending/tv/week")) {
        return jsonResult({ results: [] });
      }
      if (url.includes("/watch/providers")) {
        return jsonResult({
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
    vi.mocked(safeFetch).mockImplementation(async (url) => {
      if (url.includes("/trending/")) return jsonResult({ results: [] });
      throw new Error(`unexpected url: ${url}`);
    });

    const catalog = await fetchTrendingCatalog("test-key");
    expect(catalog).toEqual({});
  });

  it("returns an empty catalog when the trending request fails", async () => {
    vi.mocked(safeFetch).mockResolvedValue(jsonResult({}, 500));
    const catalog = await fetchTrendingCatalog("test-key");
    expect(catalog).toEqual({});
  });
});
