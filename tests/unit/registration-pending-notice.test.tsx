// Spec 264 follow-up — Handoff Unit A. Operator-reported confusion: a newcomer
// on the pending branch of /register/technician sees only the e-card + a
// "แชร์บัตร" share button with no explanation, so they don't know they're
// actually DONE and just waiting.
//
// Spec 343 U1 amends that: the notice was claiming submission the INSTANT the
// profile saved, while the id_card upload and the PDPA consent were still
// outstanding. All 4 live pending applicants stopped exactly there, two of them
// for 14 days. So the "you're done" copy is now the floor-MET branch only, and
// below the floor the card names what is left and links to it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegistrationPendingNotice } from "@/components/features/register/registration-pending-notice";
import type { ApprovalFloor } from "@/lib/register/registration-floor";

// Plain ApprovalFloor values — no `as const`, whose readonly tuple would not be
// assignable to ApprovalFloor.missing (a mutable ApprovalRequirement[]).
const met: ApprovalFloor = { met: true, missing: [] };

describe("RegistrationPendingNotice — floor met", () => {
  it("tells the applicant they're done and don't need to share anything further", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={met} />);
    expect(screen.getByText("ส่งใบสมัครแล้ว รอการอนุมัติ")).toBeInTheDocument();
  });

  it("stays role-neutral so an office applicant sees no 'ช่าง' wording (spec 286)", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={met} />);
    expect(screen.queryByText(/ช่าง/)).not.toBeInTheDocument();
  });

  it("shows the employee id as plain selectable reference text", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={met} />);
    expect(screen.getByText("รหัสพนักงานของคุณ: PRC-26-0042 — เก็บไว้อ้างอิง")).toBeInTheDocument();
  });
});

describe("RegistrationPendingNotice — floor NOT met (spec 343 D1)", () => {
  const outstanding: ApprovalFloor = { met: false, missing: ["id_card", "consent"] };

  it("does NOT claim the application was submitted", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.queryByText("ส่งใบสมัครแล้ว รอการอนุมัติ")).not.toBeInTheDocument();
  });

  it("says the application is incomplete", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.getByText("ยังส่งไม่ครบ")).toBeInTheDocument();
  });

  it("names every outstanding item, each linking to its control", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.getByRole("link", { name: "อัปโหลดบัตรประชาชน" })).toHaveAttribute(
      "href",
      "#reg-documents",
    );
    expect(screen.getByRole("link", { name: "ให้ความยินยอม (PDPA)" })).toHaveAttribute(
      "href",
      "#reg-consent",
    );
  });

  it("never tells an incomplete applicant that no card is needed", () => {
    // The old body carried "ไม่ต้องส่งบัตรให้ใครเพิ่ม" as anti-phishing advice; on an
    // INCOMPLETE application it reads as "no ID card is needed" — the D1 defect.
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.queryByText(/ไม่ต้องส่งบัตรให้ใครเพิ่ม/)).not.toBeInTheDocument();
  });

  it("counts the outstanding items in the body", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.getByText(/เหลืออีก 2 อย่าง/)).toBeInTheDocument();
  });
});
