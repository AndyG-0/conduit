import { describe, expect, it } from "vitest";
import { idAfter, moveIdBefore, swapIds } from "./reorder.js";

describe("idAfter", () => {
  it("returns the following id", () => {
    expect(idAfter(["a", "b", "c"], "a")).toBe("b");
  });

  it("returns null for the last id", () => {
    expect(idAfter(["a", "b", "c"], "c")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(idAfter(["a", "b", "c"], "z")).toBeNull();
  });
});

describe("swapIds", () => {
  it("swaps two adjacent ids", () => {
    expect(swapIds(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
  });

  it("swaps two non-adjacent ids", () => {
    expect(swapIds(["a", "b", "c"], "a", "c")).toEqual(["c", "b", "a"]);
  });

  it("is a no-op when swapping an id with itself", () => {
    const ids = ["a", "b", "c"];
    expect(swapIds(ids, "a", "a")).toBe(ids);
  });

  it("is a no-op when either id is missing", () => {
    const ids = ["a", "b", "c"];
    expect(swapIds(ids, "a", "z")).toBe(ids);
    expect(swapIds(ids, "z", "a")).toBe(ids);
  });
});

describe("moveIdBefore", () => {
  it("moves an id to the front", () => {
    expect(moveIdBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("moves an id into the middle", () => {
    expect(moveIdBefore(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("moves an id to the end when beforeId is null", () => {
    expect(moveIdBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when the id is already immediately before beforeId", () => {
    expect(moveIdBefore(["a", "b", "c"], "a", "b")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when movedId is missing", () => {
    const ids = ["a", "b", "c"];
    expect(moveIdBefore(ids, "z", "b")).toBe(ids);
  });

  it("is a no-op when beforeId is missing", () => {
    const ids = ["a", "b", "c"];
    expect(moveIdBefore(ids, "a", "z")).toBe(ids);
  });

  it("is a no-op when movedId equals beforeId", () => {
    const ids = ["a", "b", "c"];
    expect(moveIdBefore(ids, "a", "a")).toBe(ids);
  });
});
