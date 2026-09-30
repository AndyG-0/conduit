import { describe, expect, it } from "vitest";
import { slugify } from "./slugify.js";

describe("slugify", () => {
  it("lowercases and hyphenates basic names", () => {
    expect(slugify("Disney+")).toBe("disney");
    expect(slugify("YouTube TV")).toBe("youtube-tv");
    expect(slugify("  Sling TV  ")).toBe("sling-tv");
    expect(slugify("!!!")).toBe("");
  });

  it("collapses repeated separators", () => {
    expect(slugify("a   b---c")).toBe("a-b-c");
  });
});
