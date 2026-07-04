// Spec 263 U2 — the technician registration doc storage path builder. Path shape
// (U1b migration `20260813071300`'s storage policies, foldername-indexed):
//   technician/<auth.uid()>/<purpose>/<attachmentId>.<ext>
// Distinct from buildContactDocPath (2-segment kind/contactId/file) — this bucket
// prefix is 3 segments (technician/uid/purpose) keyed on auth.uid(), not a
// contact/contractor id. Pure — importable from client (upload target) and the
// server action, which REBUILDS the path itself (never trusts a client path).

import { describe, it, expect } from "vitest";
import { buildTechnicianDocPath } from "@/lib/register/technician-path";

const UID = "11111111-1111-1111-1111-111111111111";
const ATTACHMENT_ID = "22222222-2222-2222-2222-222222222222";

describe("buildTechnicianDocPath", () => {
  it("builds the technician/<uid>/<purpose>/<attachmentId>.<ext> path", () => {
    expect(buildTechnicianDocPath(UID, "id_card", ATTACHMENT_ID, "jpeg")).toBe(
      `technician/${UID}/id_card/${ATTACHMENT_ID}.jpeg`,
    );
    expect(buildTechnicianDocPath(UID, "profile_photo", ATTACHMENT_ID, "png")).toBe(
      `technician/${UID}/profile_photo/${ATTACHMENT_ID}.png`,
    );
  });

  it("rejects an invalid uid", () => {
    expect(buildTechnicianDocPath("not-a-uuid", "id_card", ATTACHMENT_ID, "jpeg")).toBeNull();
  });

  it("rejects an invalid purpose", () => {
    // @ts-expect-error invalid purpose
    expect(buildTechnicianDocPath(UID, "bank_book", ATTACHMENT_ID, "jpeg")).toBeNull();
  });

  it("rejects an invalid attachment id", () => {
    expect(buildTechnicianDocPath(UID, "id_card", "not-a-uuid", "jpeg")).toBeNull();
  });

  it("rejects an invalid ext", () => {
    // @ts-expect-error invalid ext
    expect(buildTechnicianDocPath(UID, "id_card", ATTACHMENT_ID, "gif")).toBeNull();
  });
});
