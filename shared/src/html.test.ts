import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html.js";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("leaves ordinary text unchanged", () => {
    expect(escapeHtml("Netflix")).toBe("Netflix");
  });
});
