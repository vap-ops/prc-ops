// Writing failing test first.
//
// Spec 263 U3 — pure view-model for the back-office approval queue row: each
// row needs employee_id / full_name / status / submitted time (all direct
// fields) PLUS a doc-completeness hint (which of id_card/consent/profile_photo
// are uploaded) and whether the U1c approval floor (full_name + a live id_card)
// is met, so the queue can flag an incomplete applicant before the reviewer
// opens the detail and hits the RPC's floor rejection. Pure (no Supabase, no
// server-only) — the same purposes list as document-types.ts.

import { describe, it, expect } from "vitest";
import {
  buildRegistrationQueueRow,
  meetsApprovalFloor,
  type RegistrationQueueInput,
} from "@/lib/register/registration-queue-view";

const BASE: RegistrationQueueInput = {
  id: "r1",
  employeeId: "PRC-26-0001",
  fullName: "สมชาย ใจดี",
  status: "pending",
  createdAt: "2026-07-01T03:00:00.000Z",
  uploadedPurposes: [],
};

describe("buildRegistrationQueueRow", () => {
  it("carries the direct fields through unchanged", () => {
    const row = buildRegistrationQueueRow(BASE);
    expect(row.id).toBe("r1");
    expect(row.employeeId).toBe("PRC-26-0001");
    expect(row.fullName).toBe("สมชาย ใจดี");
    expect(row.status).toBe("pending");
    expect(row.createdAt).toBe("2026-07-01T03:00:00.000Z");
  });

  it("falls back to a placeholder when full_name is not yet filled in", () => {
    const row = buildRegistrationQueueRow({ ...BASE, fullName: null });
    expect(row.fullName).toBeNull();
    expect(row.displayName).toMatch(/ยังไม่กรอกชื่อ/);
  });

  it("uses the applicant's name as displayName when present", () => {
    const row = buildRegistrationQueueRow(BASE);
    expect(row.displayName).toBe("สมชาย ใจดี");
  });

  it("reports 0/3 docs uploaded when nothing is uploaded", () => {
    // Spec 264 G1 + spec 296: the doc set is id_card + book_bank + profile_photo
    // (consent dropped — PDPA is an in-app record; book_bank added by spec 296).
    const row = buildRegistrationQueueRow(BASE);
    expect(row.docsUploadedCount).toBe(0);
    expect(row.docsTotal).toBe(3);
  });

  it("reports partial doc completeness", () => {
    const row = buildRegistrationQueueRow({ ...BASE, uploadedPurposes: ["id_card"] });
    expect(row.docsUploadedCount).toBe(1);
  });

  it("reports partial doc completeness (2 of 3 uploaded)", () => {
    const row = buildRegistrationQueueRow({
      ...BASE,
      uploadedPurposes: ["id_card", "profile_photo"],
    });
    expect(row.docsUploadedCount).toBe(2);
  });

  it("ignores an unknown/duplicate purpose without over-counting", () => {
    const row = buildRegistrationQueueRow({
      ...BASE,
      uploadedPurposes: ["id_card", "id_card", "not_a_real_purpose" as never],
    });
    expect(row.docsUploadedCount).toBe(1);
  });

  it("carries meetsFloor on the row (mirrors meetsApprovalFloor)", () => {
    expect(buildRegistrationQueueRow(BASE).meetsFloor).toBe(false);
    expect(buildRegistrationQueueRow({ ...BASE, uploadedPurposes: ["id_card"] }).meetsFloor).toBe(
      true,
    );
  });
});

describe("meetsApprovalFloor (mirrors the U1c RPC floor exactly)", () => {
  it("is false with no name and no id_card", () => {
    expect(meetsApprovalFloor(BASE)).toBe(false);
  });

  it("is false with a name but no id_card", () => {
    expect(meetsApprovalFloor({ ...BASE, fullName: "สมชาย ใจดี" })).toBe(false);
  });

  it("is false with an id_card but no name", () => {
    expect(meetsApprovalFloor({ ...BASE, fullName: null, uploadedPurposes: ["id_card"] })).toBe(
      false,
    );
  });

  it("is true with both a name and a live id_card", () => {
    expect(meetsApprovalFloor({ ...BASE, uploadedPurposes: ["id_card"] })).toBe(true);
  });

  it("treats a blank/whitespace-only name the same as no name (mirrors the RPC's nullif(btrim(...)))", () => {
    expect(meetsApprovalFloor({ ...BASE, fullName: "   ", uploadedPurposes: ["id_card"] })).toBe(
      false,
    );
  });
});
