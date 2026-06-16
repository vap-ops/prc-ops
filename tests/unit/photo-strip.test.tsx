// Spec 49 — photo filmstrip. Load-bearing rules: the strip is ONE
// horizontal scroll row (flex + overflow-x-auto + snap-x), never a
// growing grid; tiles are fixed squares that refuse to shrink so the
// row scrolls instead of wrapping. Both photo surfaces import these —
// the constants are the lockstep mechanism.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photos/photo-strip";

describe("PhotoStrip (spec 49)", () => {
  it("renders a horizontal scroll list with the children inside", () => {
    render(
      <PhotoStrip>
        <li data-testid="tile-a" />
        <li data-testid="tile-b" />
      </PhotoStrip>,
    );
    const list = screen.getByRole("list");
    for (const cls of ["flex", "overflow-x-auto", "snap-x"]) {
      expect(list.className.split(" ")).toContain(cls);
    }
    expect(screen.getByTestId("tile-a")).toBeInTheDocument();
    expect(screen.getByTestId("tile-b")).toBeInTheDocument();
  });

  it("pins the fixed-square non-shrinking tile geometry", () => {
    const classes = PHOTO_STRIP_TILE.split(" ");
    for (const cls of ["h-28", "w-28", "shrink-0", "snap-start"]) {
      expect(classes).toContain(cls);
    }
  });
});
