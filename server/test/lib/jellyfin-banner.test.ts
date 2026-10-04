import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/http-fetch.js", () => ({
  safeFetch: vi.fn(),
}));

describe("fetchJellyfinBanner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function jsonResult(body: unknown, status = 200) {
    return {
      status,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(body)),
      finalUrl: "",
    };
  }

  it("returns null for an unparseable base URL", async () => {
    const { fetchJellyfinBanner } =
      await import("../../src/lib/jellyfin-banner.js");
    expect(await fetchJellyfinBanner("not a url", "key")).toBeNull();
  });

  it("returns null when no API key is given", async () => {
    const { fetchJellyfinBanner } =
      await import("../../src/lib/jellyfin-banner.js");
    expect(
      await fetchJellyfinBanner("http://192.168.1.50:8096/web/#/home", "  "),
    ).toBeNull();
  });

  it("returns null when no user is found", async () => {
    const { safeFetch } = await import("../../src/lib/http-fetch.js");
    vi.mocked(safeFetch).mockResolvedValueOnce(jsonResult([]));

    const { fetchJellyfinBanner } =
      await import("../../src/lib/jellyfin-banner.js");
    expect(
      await fetchJellyfinBanner("http://192.168.1.50:8096/web/#/home", "key"),
    ).toBeNull();
  });

  it("returns null when no recent item has a backdrop", async () => {
    const { safeFetch } = await import("../../src/lib/http-fetch.js");
    vi.mocked(safeFetch)
      .mockResolvedValueOnce(jsonResult([{ Id: "user1" }]))
      .mockResolvedValueOnce(
        jsonResult([
          { Id: "item1", Name: "No Backdrop", BackdropImageTags: [] },
        ]),
      );

    const { fetchJellyfinBanner } =
      await import("../../src/lib/jellyfin-banner.js");
    expect(
      await fetchJellyfinBanner("http://192.168.1.50:8096/web/#/home", "key"),
    ).toBeNull();
  });

  it("builds a banner from the first backdrop item and titles from recent items", async () => {
    const { safeFetch } = await import("../../src/lib/http-fetch.js");
    vi.mocked(safeFetch)
      .mockResolvedValueOnce(jsonResult([{ Id: "user1" }]))
      .mockResolvedValueOnce(
        jsonResult([
          { Id: "item1", Name: "No Backdrop", BackdropImageTags: [] },
          { Id: "item2", Name: "Has Backdrop", BackdropImageTags: ["tag"] },
        ]),
      );

    const { fetchJellyfinBanner } =
      await import("../../src/lib/jellyfin-banner.js");
    const banner = await fetchJellyfinBanner(
      "http://192.168.1.50:8096/web/#/home",
      "secret-key",
    );
    expect(banner?.titles).toEqual(["No Backdrop", "Has Backdrop"]);
    expect(banner?.backdrop_url).toContain(
      "http://192.168.1.50:8096/Items/item2/Images/Backdrop?",
    );
    expect(banner?.backdrop_url).toContain("ApiKey=secret-key");

    const [usersCall] = vi.mocked(safeFetch).mock.calls;
    expect(usersCall[0]).toBe("http://192.168.1.50:8096/Users");
    expect(usersCall[1]).toMatchObject({
      headers: { "X-Emby-Token": "secret-key" },
    });
  });

  it("returns null when the users request fails", async () => {
    const { safeFetch } = await import("../../src/lib/http-fetch.js");
    vi.mocked(safeFetch).mockRejectedValueOnce(new Error("network error"));

    const { fetchJellyfinBanner } =
      await import("../../src/lib/jellyfin-banner.js");
    expect(
      await fetchJellyfinBanner("http://192.168.1.50:8096/web/#/home", "key"),
    ).toBeNull();
  });
});
