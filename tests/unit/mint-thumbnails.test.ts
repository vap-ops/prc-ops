// Spec 398 U3 — thumbnail + full-size signed-URL minting for the schedule calendar's
// photo strips and the WP-catalogue reference section.
//
// SUPERSEDES spec 257 U1's transform-based minting. Thumbnails are now STORED objects
// at a derived key in the same bucket (spec 398 D2/D3), so both URLs come from bulk
// createSignedUrls and the Storage image-transformation API is not called at all —
// that API is metered at 100 origin images/cycle and we were at 689%.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createSignedUrl = vi.fn();
const createSignedUrls = vi.fn();

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, ttl: number, opts: unknown) =>
          createSignedUrl(bucket, path, ttl, opts),
        createSignedUrls: (paths: string[], ttl: number) => createSignedUrls(bucket, paths, ttl),
      }),
    },
  }),
}));

import { mintPhotoThumbnails } from "@/lib/photos/mint-thumbnails";

const ROW = (id: string, path: string | null) => ({ id, storage_path: path });

/** Both URL sets now come from createSignedUrls; tell them apart by the key prefix. */
function respond(thumbs: Record<string, string | null>, fulls: Record<string, string | null>) {
  createSignedUrls.mockImplementation((_bucket: string, paths: string[]) => {
    const isThumb = paths[0]?.startsWith("thumbs/") ?? false;
    return Promise.resolve({
      data: paths.map((p) => {
        const url = isThumb ? thumbs[p] : fulls[p];
        return url ? { path: p, error: null, signedUrl: url } : { path: p, error: "not found" };
      }),
      error: null,
    });
  });
}

beforeEach(() => {
  createSignedUrl.mockReset();
  createSignedUrls.mockReset();
});

describe("mintPhotoThumbnails", () => {
  it("empty input → empty map, no storage calls", async () => {
    const map = await mintPhotoThumbnails([]);
    expect(map.size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("skips tombstones (null storage_path)", async () => {
    respond({}, {});
    const map = await mintPhotoThumbnails([ROW("tomb", null)]);
    expect(map.size).toBe(0);
  });

  it("serves the STORED thumbnail, and never calls the transform API", async () => {
    respond({ "thumbs/a.jpg.webp": "https://thumb/a" }, { "a.jpg": "https://full/a" });

    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg")]);

    expect(map.get("p1")).toEqual({ thumbUrl: "https://thumb/a", fullUrl: "https://full/a" });
    // The meter this whole spec exists to switch off: the singular createSignedUrl was
    // the ONLY caller that could pass `transform`, so its absence is the pin.
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(createSignedUrls).toHaveBeenCalledWith("photos", ["thumbs/a.jpg.webp"], 120);
  });

  it("falls back to the FULL-SIZE url when the thumbnail is missing — never drops the photo", async () => {
    // Load-bearing (spec 398 D4): both callers drop a photo that has no URL
    // (schedule/actions.ts `if (!url) continue`, reference-photo-section.tsx flatMap),
    // so a thumb miss must degrade to a big image, not to a vanished photo.
    respond({}, { "a.jpg": "https://full/a" });

    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg")]);

    expect(map.get("p1")).toEqual({ thumbUrl: "https://full/a", fullUrl: "https://full/a" });
  });

  it("drops a photo whose FULL-SIZE url could not be minted", async () => {
    // Nothing to show and nothing to fall back to — the object itself is unreachable.
    respond({ "thumbs/a.jpg.webp": "https://thumb/a" }, {});
    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg")]);
    expect(map.has("p1")).toBe(false);
  });

  it("does not fail the whole batch when the thumb lookup errors outright", async () => {
    createSignedUrls.mockImplementation((_bucket: string, paths: string[]) =>
      paths[0]?.startsWith("thumbs/")
        ? Promise.resolve({ data: null, error: { message: "storage down" } })
        : Promise.resolve({
            data: paths.map((p) => ({ path: p, error: null, signedUrl: `https://full/${p}` })),
            error: null,
          }),
    );

    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg")]);

    expect(map.get("p1")).toEqual({
      thumbUrl: "https://full/a.jpg",
      fullUrl: "https://full/a.jpg",
    });
  });

  it("mints multiple photos in ONE thumb call, keyed by row id", async () => {
    respond(
      { "thumbs/a.jpg.webp": "https://thumb/a", "thumbs/b.jpg.webp": "https://thumb/b" },
      { "a.jpg": "https://full/a", "b.jpg": "https://full/b" },
    );

    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg"), ROW("p2", "b.jpg")]);

    expect(map.size).toBe(2);
    expect(map.get("p1")?.thumbUrl).toBe("https://thumb/a");
    expect(map.get("p2")?.thumbUrl).toBe("https://thumb/b");
    // One bulk call per URL kind — not one call per photo, which is what the
    // transform path did and why the quota went 689% over.
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });
});
