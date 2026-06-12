// Spec 65 §A — generic signed-URL minting core. Replaces the
// self-described clone pair (photos/signed-urls.ts ↔
// purchasing/attachment-signed-urls.ts); both wrappers stay exported.
// Closes the missing-unit-test note recorded in the tracker for
// mintSignedUrlsForPhotos.
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSignedUrls = vi.fn();

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (paths: string[], ttl: number) => createSignedUrls(bucket, paths, ttl),
      }),
    },
  }),
}));

import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { mintSignedUrlsForAttachments } from "@/lib/purchasing/attachment-signed-urls";
import { PHOTOS_BUCKET, PR_ATTACHMENTS_BUCKET, REPORTS_BUCKET } from "@/lib/storage/buckets";

beforeEach(() => {
  createSignedUrls.mockReset();
});

describe("bucket name constants", () => {
  it("pin the live bucket ids", () => {
    expect(PHOTOS_BUCKET).toBe("photos");
    expect(PR_ATTACHMENTS_BUCKET).toBe("pr-attachments");
    expect(REPORTS_BUCKET).toBe("reports");
  });
});

describe("mintSignedUrls", () => {
  it("returns an empty map without touching storage when nothing has a path", () => {
    return mintSignedUrls(PHOTOS_BUCKET, [{ id: "a", storage_path: null }]).then((map) => {
      expect(map.size).toBe(0);
      expect(createSignedUrls).not.toHaveBeenCalled();
    });
  });

  it("skips tombstones, signs the rest at 120s TTL, maps by row id", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { error: null, signedUrl: "https://signed/p1" },
        { error: null, signedUrl: "https://signed/p2" },
      ],
      error: null,
    });
    const map = await mintSignedUrls(PHOTOS_BUCKET, [
      { id: "p1", storage_path: "proj/wp/p1.jpeg" },
      { id: "tomb", storage_path: null },
      { id: "p2", storage_path: "proj/wp/p2.jpeg" },
    ]);
    expect(createSignedUrls).toHaveBeenCalledWith(
      "photos",
      ["proj/wp/p1.jpeg", "proj/wp/p2.jpeg"],
      120,
    );
    expect(map.get("p1")).toBe("https://signed/p1");
    expect(map.get("p2")).toBe("https://signed/p2");
    expect(map.size).toBe(2);
  });

  it("skips per-entry errors without failing the batch", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { error: "Object not found", signedUrl: null },
        { error: null, signedUrl: "https://signed/ok" },
      ],
      error: null,
    });
    const map = await mintSignedUrls(PHOTOS_BUCKET, [
      { id: "missing", storage_path: "x" },
      { id: "ok", storage_path: "y" },
    ]);
    expect(map.has("missing")).toBe(false);
    expect(map.get("ok")).toBe("https://signed/ok");
  });

  it("throws on a batch-level error", async () => {
    const boom = new Error("storage down");
    createSignedUrls.mockResolvedValue({ data: null, error: boom });
    await expect(mintSignedUrls(PHOTOS_BUCKET, [{ id: "a", storage_path: "p" }])).rejects.toBe(
      boom,
    );
  });
});

describe("wrappers", () => {
  it("photos wrapper signs against the photos bucket", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ error: null, signedUrl: "https://signed/w" }],
      error: null,
    });
    const map = await mintSignedUrlsForPhotos([
      {
        id: "w",
        work_package_id: "wp",
        phase: "before",
        storage_path: "a/b/w.jpeg",
        captured_at_client: null,
        uploaded_by: "u",
        created_at: "2026-06-13T00:00:00Z",
        superseded_by: null,
      },
    ]);
    expect(createSignedUrls.mock.calls[0]?.[0]).toBe("photos");
    expect(map.get("w")).toBe("https://signed/w");
  });

  it("attachments wrapper signs against the pr-attachments bucket", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ error: null, signedUrl: "https://signed/a" }],
      error: null,
    });
    const map = await mintSignedUrlsForAttachments([{ id: "a", storage_path: "pr/a.jpeg" }]);
    expect(createSignedUrls.mock.calls[0]?.[0]).toBe("pr-attachments");
    expect(map.get("a")).toBe("https://signed/a");
  });
});
