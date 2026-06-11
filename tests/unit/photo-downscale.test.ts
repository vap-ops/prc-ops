import { describe, expect, it } from "vitest";
import { computeDownscaleTarget, DOWNSCALE_MAX_EDGE } from "@/lib/photos/downscale";
import { photoExtToMime } from "@/lib/photos/path";

describe("computeDownscaleTarget", () => {
  it("scales a landscape photo down to the max long edge, preserving aspect", () => {
    expect(computeDownscaleTarget(4000, 3000)).toEqual({ width: 2000, height: 1500, needed: true });
  });

  it("scales a portrait photo by its long edge", () => {
    expect(computeDownscaleTarget(3000, 4000)).toEqual({ width: 1500, height: 2000, needed: true });
  });

  it("scales a square photo", () => {
    expect(computeDownscaleTarget(5000, 5000)).toEqual({ width: 2000, height: 2000, needed: true });
  });

  it("handles a typical phone resolution", () => {
    expect(computeDownscaleTarget(4032, 3024)).toEqual({ width: 2000, height: 1500, needed: true });
  });

  it("rounds a genuinely fractional scaled edge to the nearest integer", () => {
    // 1000 * 2000/3000 = 666.67 → 667
    expect(computeDownscaleTarget(3000, 1000)).toEqual({ width: 2000, height: 667, needed: true });
  });

  it("passes through when the long edge is exactly at the cap", () => {
    expect(computeDownscaleTarget(2000, 1200)).toEqual({
      width: 2000,
      height: 1200,
      needed: false,
    });
  });

  it("never upscales a small photo", () => {
    expect(computeDownscaleTarget(800, 600)).toEqual({ width: 800, height: 600, needed: false });
  });

  it("treats degenerate dimensions as not needing downscale", () => {
    expect(computeDownscaleTarget(0, 0)).toEqual({ width: 0, height: 0, needed: false });
    expect(computeDownscaleTarget(-1, 4000)).toEqual({ width: -1, height: 4000, needed: false });
  });

  it("honours a custom max edge", () => {
    expect(computeDownscaleTarget(1000, 500, 100)).toEqual({
      width: 100,
      height: 50,
      needed: true,
    });
  });

  it("exports the ADR 0036 cap", () => {
    expect(DOWNSCALE_MAX_EDGE).toBe(2000);
  });
});

describe("photoExtToMime", () => {
  it("is the inverse of mimeToPhotoExt for every legal ext", () => {
    expect(photoExtToMime("jpeg")).toBe("image/jpeg");
    expect(photoExtToMime("png")).toBe("image/png");
    expect(photoExtToMime("webp")).toBe("image/webp");
    expect(photoExtToMime("heic")).toBe("image/heic");
  });
});
