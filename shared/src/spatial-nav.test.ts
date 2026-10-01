import { describe, expect, it } from "vitest";
import { findNextFocusTarget, type FocusCandidate } from "./spatial-nav.js";

// A 3x2 grid of 100x100 tiles with 20px gaps, laid out left-to-right,
// top-to-bottom: a b c / d e f.
function rect(col: number, row: number) {
  const left = col * 120;
  const top = row * 120;
  return { left, top, right: left + 100, bottom: top + 100 };
}

const grid: FocusCandidate[] = [
  { id: "a", rect: rect(0, 0) },
  { id: "b", rect: rect(1, 0) },
  { id: "c", rect: rect(2, 0) },
  { id: "d", rect: rect(0, 1) },
  { id: "e", rect: rect(1, 1) },
  { id: "f", rect: rect(2, 1) },
];

describe("findNextFocusTarget", () => {
  it("moves right within a row", () => {
    expect(findNextFocusTarget(grid, "a", "right")).toBe("b");
  });

  it("moves left within a row", () => {
    expect(findNextFocusTarget(grid, "c", "left")).toBe("b");
  });

  it("moves down to the aligned tile below", () => {
    expect(findNextFocusTarget(grid, "b", "down")).toBe("e");
  });

  it("moves up to the aligned tile above", () => {
    expect(findNextFocusTarget(grid, "e", "up")).toBe("b");
  });

  it("returns null past the grid's edge", () => {
    expect(findNextFocusTarget(grid, "a", "up")).toBeNull();
    expect(findNextFocusTarget(grid, "c", "right")).toBeNull();
    expect(findNextFocusTarget(grid, "d", "left")).toBeNull();
    expect(findNextFocusTarget(grid, "f", "down")).toBeNull();
  });

  it("prefers the aligned neighbor over a closer diagonal one", () => {
    // From "d" (bottom-left), moving right should reach "e" (aligned same
    // row) rather than jumping to "b" (closer in raw distance but off-row).
    expect(findNextFocusTarget(grid, "d", "right")).toBe("e");
  });

  it("returns null for an unknown current id", () => {
    expect(findNextFocusTarget(grid, "z", "right")).toBeNull();
  });
});
