// Spec 264 follow-up — Handoff Unit A. Operator-reported confusion: a newcomer
// on the pending branch of /register/technician sees only the e-card + a
// "แชร์บัตร" share button with no explanation, so they don't know they're
// actually DONE and just waiting. This static notice (COPY ONLY — no new
// state, the page already reads registration.status) tells them: submission
// received, no further share needed, the page flips itself on approval.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegistrationPendingNotice } from "@/components/features/register/registration-pending-notice";

describe("RegistrationPendingNotice", () => {
  it("tells the applicant they're done and don't need to share anything further", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" />);
    expect(screen.getByText("ส่งใบสมัครแล้ว รอการอนุมัติ")).toBeInTheDocument();
    expect(
      screen.getByText(
        "ทีมงานได้รับใบสมัครของคุณแล้ว ไม่ต้องส่งบัตรให้ใครเพิ่ม เมื่ออนุมัติแล้ว หน้านี้จะกลายเป็นหน้าช่างของคุณเอง — เปิดแอปอีกครั้งเพื่อดูสถานะได้ตลอด",
      ),
    ).toBeInTheDocument();
  });

  it("shows the employee id as plain selectable reference text", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" />);
    expect(screen.getByText("รหัสพนักงานของคุณ: PRC-26-0042 — เก็บไว้อ้างอิง")).toBeInTheDocument();
  });
});
