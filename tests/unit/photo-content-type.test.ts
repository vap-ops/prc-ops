import { describe, expect, it } from "vitest";
import { blobWithType } from "@/lib/photos/path";

// Feedback 10a15ebe — the REAL root cause of the WP-photo "ลองใหม่" loop (proven
// with an authenticated upload against live storage): supabase-js sends the Blob's
// `.type` as the upload content-type and IGNORES the `contentType` option, and every
// bucket enforces allowed_mime_types for AUTHENTICATED uploads. iOS Safari's
// canvas.toBlob (and an IndexedDB round-trip) can yield a Blob whose `.type` is
// empty, which storage treats as application/octet-stream and rejects with a 400
// "mime type application/octet-stream is not supported". blobWithType guarantees the
// blob carries the intended mime so the correct content-type is actually sent.
describe("blobWithType (feedback 10a15ebe)", () => {
  it("sets the type on an empty-type blob (the iOS canvas.toBlob / IDB case)", () => {
    const out = blobWithType(new Blob(["abc"]), "image/jpeg");
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBe(3);
  });

  it("corrects a wrong (octet-stream) type", () => {
    const out = blobWithType(
      new Blob(["abcd"], { type: "application/octet-stream" }),
      "image/jpeg",
    );
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBe(4);
  });

  it("returns the SAME blob untouched when the type already matches (no needless copy)", () => {
    const blob = new Blob(["x"], { type: "image/heic" });
    expect(blobWithType(blob, "image/heic")).toBe(blob);
  });

  it("preserves the bytes when re-wrapping", async () => {
    const out = blobWithType(new Blob(["hello"]), "image/png");
    expect(out.type).toBe("image/png");
    expect(await out.text()).toBe("hello");
  });
});
