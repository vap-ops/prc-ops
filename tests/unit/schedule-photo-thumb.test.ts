// Spec 398 U2 — a newly-inserted photo schedules its own stored thumbnail.
//
// Runs in `after()` (stable since Next 15.1; on Vercel it is backed by waitUntil) so
// the SA's upload response is never blocked by an image resize, and so the offline
// upload queue (ADR 0039) is not touched at all — its invariant is that an item is
// removed only after both of ITS steps succeed, and a thumbnail is not evidence.

import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.fn();
const generatePhotoThumb = vi.fn();
const defaultThumbDeps = vi.fn((_admin: unknown) => ({ marker: "deps" }));
const createAdminClient = vi.fn(() => ({ marker: "admin" }));

vi.mock("next/server", () => ({ after: (cb: () => unknown) => after(cb) }));
vi.mock("@/lib/db/admin", () => ({ createClient: () => createAdminClient() }));
vi.mock("@/lib/photos/generate-thumb", () => ({
  generatePhotoThumb: (path: string, deps: unknown) => generatePhotoThumb(path, deps),
  defaultThumbDeps: (admin: unknown) => defaultThumbDeps(admin),
}));

import { schedulePhotoThumb } from "@/lib/photos/schedule-thumb";

const PATH = "proj/wp/photo.jpeg";

beforeEach(() => {
  after.mockReset();
  generatePhotoThumb.mockReset().mockResolvedValue({ status: "created", key: "thumbs/x" });
  defaultThumbDeps.mockClear();
  createAdminClient.mockClear();
});

describe("schedulePhotoThumb", () => {
  it("defers the work — nothing runs during the request itself", () => {
    schedulePhotoThumb(PATH);

    expect(after).toHaveBeenCalledTimes(1);
    expect(generatePhotoThumb).not.toHaveBeenCalled();
  });

  it("generates the thumbnail for that path when the deferred callback runs", async () => {
    schedulePhotoThumb(PATH);
    await after.mock.calls[0]![0]();

    expect(generatePhotoThumb).toHaveBeenCalledWith(PATH, { marker: "deps" });
    expect(defaultThumbDeps).toHaveBeenCalledWith({ marker: "admin" });
  });

  it("swallows a generation failure — a photo without a thumbnail still renders", async () => {
    generatePhotoThumb.mockResolvedValue({ status: "failed", reason: "unsupported image format" });
    schedulePhotoThumb(PATH);

    await expect(after.mock.calls[0]![0]()).resolves.not.toThrow();
  });

  it("swallows a thrown generation error too", async () => {
    generatePhotoThumb.mockRejectedValue(new Error("boom"));
    schedulePhotoThumb(PATH);

    await expect(after.mock.calls[0]![0]()).resolves.not.toThrow();
  });

  it("does nothing at all for an empty path", () => {
    schedulePhotoThumb("");
    expect(after).not.toHaveBeenCalled();
  });
});

describe("addPhoto wiring", () => {
  // A source pin, because addPhoto is a server action this suite cannot execute. It
  // proves the call EXISTS and is reachable; the behaviour above is what proves it is
  // right. Comments are stripped first — a comment naming the symbol would otherwise
  // satisfy the assertion on its own (the documenting-the-hazard trap).
  const source = readFileSync(
    "src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts",
    "utf8",
  )
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

  it("addPhoto imports AND calls schedulePhotoThumb — exactly one call site", () => {
    // 2 = the import plus one real call. Pinning the exact count, not a >=2 floor:
    // with one real use, >=2 passes with that use deleted.
    expect(source.split("schedulePhotoThumb").length - 1).toBe(2);
    expect(source).toContain("schedulePhotoThumb(storagePath)");
  });

  it("schedules the thumbnail only on the success path, after the insert branch", () => {
    // If it moved above the insert, a refused photo (bad role, closed after_fix window,
    // rejected pairing) would still schedule a generation for an object that will never
    // exist. Both anchors are on the success tail of the action.
    const call = source.indexOf("schedulePhotoThumb(storagePath)");
    const insert = source.indexOf('.from("photo_logs").insert(');
    const ret = source.indexOf("return { ok: true, photoId: input.photoId, transitioned }");

    expect(insert).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(insert);
    expect(call).toBeLessThan(ret);
  });
});
