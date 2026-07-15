// Writing failing test first.
//
// Spec 323 U1d — canonical rental-settlement-receipt storage path:
//   {settlement_id}/{attachment_id}.{ext}
// Single-level folder — the bucket INSERT policy checks foldername depth = 1. Pure
// module: the client builds it to upload bytes, the server action REBUILDS it (a
// client-supplied path is never trusted).

import { describe, expect, it } from "vitest";

import { buildRentalReceiptPath } from "@/lib/equipment/rental-receipt-path";

const SETTLEMENT = "cc000323-0000-4000-8000-000000000001";
const ATTACHMENT = "dd000323-0000-4000-8000-000000000001";

describe("buildRentalReceiptPath", () => {
  it("builds {settlement}/{attachment}.{ext} for a pdf", () => {
    expect(buildRentalReceiptPath(SETTLEMENT, ATTACHMENT, "pdf")).toBe(
      `${SETTLEMENT}/${ATTACHMENT}.pdf`,
    );
  });

  it("builds a single-level folder path (depth 1)", () => {
    const path = buildRentalReceiptPath(SETTLEMENT, ATTACHMENT, "png");
    expect(path).not.toBeNull();
    expect(path!.split("/").length).toBe(2);
  });

  it("rejects a non-uuid settlement or attachment id", () => {
    expect(buildRentalReceiptPath("not-a-uuid", ATTACHMENT, "pdf")).toBeNull();
    expect(buildRentalReceiptPath(SETTLEMENT, "nope", "pdf")).toBeNull();
  });

  it("rejects an unknown extension", () => {
    // @ts-expect-error — exercising the runtime guard with an invalid ext
    expect(buildRentalReceiptPath(SETTLEMENT, ATTACHMENT, "exe")).toBeNull();
  });
});
