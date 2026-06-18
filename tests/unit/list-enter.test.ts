// Spec 140 (app-feel slice 5) — the staggered list-enter helper. Pure: returns
// the motion class + the row's capped stagger index (a CSS var the globals.css
// `.list-enter` keyframe reads for animation-delay). The cap is the load-bearing
// logic — a long list's tail must not wait seconds.

import { describe, it, expect } from "vitest";

import { listEnterProps, LIST_ENTER_STAGGER_CAP } from "@/lib/ui/list-enter";

describe("listEnterProps", () => {
  it("returns the list-enter class with the row's stagger index", () => {
    const props = listEnterProps(3);
    expect(props.className).toBe("list-enter");
    expect(props.style).toEqual({ "--enter-index": 3 });
  });

  it("clamps the first row and negatives to index 0 (no negative delay)", () => {
    expect(listEnterProps(0).style).toEqual({ "--enter-index": 0 });
    expect(listEnterProps(-5).style).toEqual({ "--enter-index": 0 });
  });

  it("caps the stagger so a long list's tail shares the last delay step", () => {
    expect(listEnterProps(LIST_ENTER_STAGGER_CAP).style).toEqual({
      "--enter-index": LIST_ENTER_STAGGER_CAP,
    });
    expect(listEnterProps(LIST_ENTER_STAGGER_CAP + 10).style).toEqual({
      "--enter-index": LIST_ENTER_STAGGER_CAP,
    });
  });

  it("truncates fractional indices to a whole step", () => {
    expect(listEnterProps(2.9).style).toEqual({ "--enter-index": 2 });
  });
});
