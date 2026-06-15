import { describe, expect, it } from "vitest";
import { adjacentRecordIds, flattenRecordOrder } from "@/lib/purchasing/grid-record-nav";

// Spec 109 — the review drawer steps prev/next through the grid's records in
// reading order (band order, then within-band order). Pure helpers, TDD-first.

const groups = [
  { items: [{ id: "a" }, { id: "b" }] },
  { items: [{ id: "c" }] },
  { items: [{ id: "d" }, { id: "e" }] },
];

describe("flattenRecordOrder", () => {
  it("flattens banded groups to one list in reading order", () => {
    expect(flattenRecordOrder(groups).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns an empty list for no groups", () => {
    expect(flattenRecordOrder([])).toEqual([]);
  });

  it("skips empty bands", () => {
    const g = [{ items: [] }, { items: [{ id: "x" }] }, { items: [] }];
    expect(flattenRecordOrder(g).map((r) => r.id)).toEqual(["x"]);
  });
});

describe("adjacentRecordIds", () => {
  const order = flattenRecordOrder(groups);

  it("gives prev/next + position for a middle record", () => {
    expect(adjacentRecordIds(order, "c")).toEqual({
      prevId: "b",
      nextId: "d",
      index: 2,
      total: 5,
    });
  });

  it("has no prev at the first record (non-wrapping)", () => {
    expect(adjacentRecordIds(order, "a")).toEqual({
      prevId: null,
      nextId: "b",
      index: 0,
      total: 5,
    });
  });

  it("has no next at the last record (non-wrapping)", () => {
    expect(adjacentRecordIds(order, "e")).toEqual({
      prevId: "d",
      nextId: null,
      index: 4,
      total: 5,
    });
  });

  it("returns index -1 with null neighbours for an absent id", () => {
    expect(adjacentRecordIds(order, "zzz")).toEqual({
      prevId: null,
      nextId: null,
      index: -1,
      total: 5,
    });
  });

  it("a single record has no neighbours", () => {
    expect(adjacentRecordIds([{ id: "solo" }], "solo")).toEqual({
      prevId: null,
      nextId: null,
      index: 0,
      total: 1,
    });
  });
});
