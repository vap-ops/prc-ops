// Spec 257 U1 — thumbnail + full-size signed-URL minting for the schedule
// calendar's photo strips. Bulk createSignedUrls has no transform option
// (verified against the storage-js source), so thumbnails mint per-photo via
// the singular createSignedUrl; full-size URLs reuse the existing bulk
// mintSignedUrls core unchanged.

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

beforeEach(() => {
  createSignedUrl.mockReset();
  createSignedUrls.mockReset();
});

describe("mintPhotoThumbnails", () => {
  it("empty input → empty map, no storage calls", async () => {
    const map = await mintPhotoThumbnails([]);
    expect(map.size).toBe(0);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("skips tombstones (null storage_path)", async () => {
    createSignedUrls.mockResolvedValue({ data: [], error: null });
    const map = await mintPhotoThumbnails([ROW("tomb", null)]);
    expect(map.size).toBe(0);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("mints both a transformed thumb and a full-size URL per photo", async () => {
    createSignedUrl.mockImplementation((_bucket, path) =>
      Promise.resolve({ data: { signedUrl: `https://thumb/${path}` }, error: null }),
    );
    createSignedUrls.mockResolvedValue({
      data: [{ error: null, signedUrl: "https://full/a.jpg" }],
      error: null,
    });

    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg")]);

    expect(createSignedUrl).toHaveBeenCalledWith(
      "photos",
      "a.jpg",
      120,
      expect.objectContaining({ transform: expect.objectContaining({ width: 320 }) }),
    );
    expect(map.get("p1")).toEqual({
      thumbUrl: "https://thumb/a.jpg",
      fullUrl: "https://full/a.jpg",
    });
  });

  it("drops a photo whose thumb mint errors, even if the full URL succeeded", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: new Error("nope") });
    createSignedUrls.mockResolvedValue({
      data: [{ error: null, signedUrl: "https://full/a.jpg" }],
      error: null,
    });
    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg")]);
    expect(map.has("p1")).toBe(false);
  });

  it("mints multiple photos concurrently, keyed by row id", async () => {
    createSignedUrl.mockImplementation((_bucket, path) =>
      Promise.resolve({ data: { signedUrl: `https://thumb/${path}` }, error: null }),
    );
    createSignedUrls.mockResolvedValue({
      data: [
        { error: null, signedUrl: "https://full/a.jpg" },
        { error: null, signedUrl: "https://full/b.jpg" },
      ],
      error: null,
    });
    const map = await mintPhotoThumbnails([ROW("p1", "a.jpg"), ROW("p2", "b.jpg")]);
    expect(map.size).toBe(2);
    expect(map.get("p1")?.thumbUrl).toBe("https://thumb/a.jpg");
    expect(map.get("p2")?.thumbUrl).toBe("https://thumb/b.jpg");
  });
});
