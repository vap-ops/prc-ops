// Spec 263 U2 — start_technician_registration / update_own_technician_registration /
// add_technician_registration_doc RPC errors mapped to applicant-facing Thai. The
// RPCs raise distinct messages (mirrors portal-claim-error's shape); the workspace
// shows a human reason, never the raw error.

import { describe, it, expect } from "vitest";
import { registrationErrorToThai } from "@/lib/register/registration-error";

describe("registrationErrorToThai", () => {
  it("maps each known RPC error to a distinct Thai message", () => {
    expect(registrationErrorToThai("start_technician_registration: already registered")).toMatch(
      /สมัครไปแล้ว/,
    );
    expect(
      registrationErrorToThai("update_own_technician_registration: no registration for this user"),
    ).toMatch(/ยังไม่ได้สมัคร/);
    expect(
      registrationErrorToThai(
        "update_own_technician_registration: registration is no longer pending",
      ),
    ).toMatch(/ไม่สามารถแก้ไขได้/);
    expect(
      registrationErrorToThai("add_technician_registration_doc: no registration for this user"),
    ).toMatch(/ยังไม่ได้สมัคร/);
    expect(
      registrationErrorToThai("add_technician_registration_doc: registration is no longer pending"),
    ).toMatch(/ไม่สามารถแก้ไขได้/);
  });

  it("falls back to a generic message for an unknown error", () => {
    const msg = registrationErrorToThai("some unexpected failure");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/ไม่สำเร็จ/);
  });

  // Spec 263 U3 — the U1c approve/reject RPC raise messages, back-office-facing.
  it("maps the approve/reject gate-denial raise to a Thai permission message", () => {
    expect(registrationErrorToThai("approve_technician_registration: role not permitted")).toMatch(
      /ไม่มีสิทธิ์/,
    );
    expect(registrationErrorToThai("reject_technician_registration: role not permitted")).toMatch(
      /ไม่มีสิทธิ์/,
    );
  });

  it("maps 'registration not found' to a distinct Thai message", () => {
    expect(
      registrationErrorToThai("approve_technician_registration: registration not found"),
    ).toMatch(/ไม่พบ/);
  });

  it("maps 'registration is not pending' to a distinct Thai message (double-decide guard)", () => {
    expect(
      registrationErrorToThai("approve_technician_registration: registration is not pending"),
    ).toMatch(/ไม่ได้อยู่ในสถานะรออนุมัติ/);
    expect(
      registrationErrorToThai("reject_technician_registration: registration is not pending"),
    ).toMatch(/ไม่ได้อยู่ในสถานะรออนุมัติ/);
  });

  it("maps the approval floor raises (missing name / missing id_card) distinctly", () => {
    expect(
      registrationErrorToThai(
        "approve_technician_registration: full_name required before approval",
      ),
    ).toMatch(/ชื่อ/);
    expect(
      registrationErrorToThai(
        "approve_technician_registration: an id_card attachment is required before approval",
      ),
    ).toMatch(/บัตรประชาชน/);
  });
});
