import { describe, expect, it, vi, beforeEach } from "vitest";
import { findIconHref } from "../../src/lib/favicon.js";

describe("findIconHref", () => {
  it("finds a plain rel=icon link", () => {
    const html = `<html><head><link rel="icon" href="/favicon.png"></head></html>`;
    expect(findIconHref(html)).toBe("/favicon.png");
  });

  it("finds a rel='shortcut icon' link with single quotes", () => {
    const html = `<link rel='shortcut icon' href='/assets/icon.png'>`;
    expect(findIconHref(html)).toBe("/assets/icon.png");
  });

  it("prefers a plain icon over an apple-touch-icon appearing first", () => {
    const html = `
      <link rel="apple-touch-icon" href="/apple-touch.png">
      <link rel="icon" href="/favicon.png">
    `;
    expect(findIconHref(html)).toBe("/favicon.png");
  });

  it("falls back to apple-touch-icon if no plain icon link exists", () => {
    const html = `<link rel="apple-touch-icon" href="/apple-touch.png">`;
    expect(findIconHref(html)).toBe("/apple-touch.png");
  });

  it("returns null when there is no icon link at all", () => {
    expect(findIconHref("<html><head></head></html>")).toBeNull();
  });

  it("ignores unrelated rel values", () => {
    const html = `<link rel="stylesheet" href="/style.css">`;
    expect(findIconHref(html)).toBeNull();
  });
});

vi.mock("../../src/lib/http-fetch.js", () => ({
  safeFetch: vi.fn(),
}));

describe("fetchFavicon", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the direct /favicon.ico when it fetches successfully", async () => {
    const { safeFetch } = await import("../../src/lib/http-fetch.js");
    vi.mocked(safeFetch).mockResolvedValueOnce({
      status: 200,
      contentType: "image/x-icon",
      body: Buffer.from("icon-bytes"),
      finalUrl: "https://example.com/favicon.ico",
    });

    const { fetchFavicon } = await import("../../src/lib/favicon.js");
    const result = await fetchFavicon("https://example.com/");
    expect(result).toEqual({
      contentType: "image/x-icon",
      body: Buffer.from("icon-bytes"),
    });
  });

  it("falls back to scraping the page's <link rel=icon> tag", async () => {
    const { safeFetch } = await import("../../src/lib/http-fetch.js");
    vi.mocked(safeFetch)
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({
        status: 200,
        contentType: "text/html",
        body: Buffer.from(`<link rel="icon" href="/icon.png">`),
        finalUrl: "https://example.com/",
      })
      .mockResolvedValueOnce({
        status: 200,
        contentType: "image/png",
        body: Buffer.from("scraped-icon-bytes"),
        finalUrl: "https://example.com/icon.png",
      });

    const { fetchFavicon } = await import("../../src/lib/favicon.js");
    const result = await fetchFavicon("https://example.com/");
    expect(result).toEqual({
      contentType: "image/png",
      body: Buffer.from("scraped-icon-bytes"),
    });
  });

  it("returns null when both the direct favicon and the page scrape fail", async () => {
    const { safeFetch } = await import("../../src/lib/http-fetch.js");
    vi.mocked(safeFetch)
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({
        status: 200,
        contentType: "text/html",
        body: Buffer.from(`<html><head></head></html>`),
        finalUrl: "https://example.com/",
      });

    const { fetchFavicon } = await import("../../src/lib/favicon.js");
    const result = await fetchFavicon("https://example.com/");
    expect(result).toBeNull();
  });

  it("returns null for an invalid base URL", async () => {
    const { fetchFavicon } = await import("../../src/lib/favicon.js");
    const result = await fetchFavicon("not-a-url");
    expect(result).toBeNull();
  });
});
