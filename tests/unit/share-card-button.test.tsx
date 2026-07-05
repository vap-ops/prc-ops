// Spec 264 follow-up — Handoff Unit A. Operator-reported confusion: an SA who
// receives the share text over LINE doesn't know what's wanted of them
// (approval already happens via the back-office queue, not via this share).
// Reword the button label + shared/clipboard-fallback text so both sides of
// the handoff understand it's an optional courtesy notice, not a request for
// action. Web Share / clipboard mechanics unchanged (still exercised as the
// clipboard-fallback path since jsdom has no navigator.share).

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShareCardButton } from "@/components/features/register/share-card-button";

const FULL_NAME = "สมชาย ใจดี";
const EMPLOYEE_ID = "PRC-26-0042";

describe("ShareCardButton", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("relabels the button to clarify the share is for an on-site supervisor, optional", () => {
    render(<ShareCardButton fullName={FULL_NAME} employeeId={EMPLOYEE_ID} />);
    expect(
      screen.getByRole("button", { name: /แชร์บัตรให้หัวหน้าที่หน้างาน \(ถ้ามี\)/ }),
    ).toBeInTheDocument();
  });

  it("shares/copies text telling the receiving SA no action is needed", async () => {
    render(<ShareCardButton fullName={FULL_NAME} employeeId={EMPLOYEE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /แชร์บัตรให้หัวหน้าที่หน้างาน/ }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
    const calls = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls;
    const copied = calls[0]?.[0] as string;
    expect(copied).toContain("บัตรพนักงาน PRC (รออนุมัติ)");
    expect(copied).toContain(
      `${FULL_NAME} สมัครเป็นช่างกับ PRC แล้ว รหัส ${EMPLOYEE_ID} — กำลังรอทีมงานอนุมัติ ไม่ต้องดำเนินการใด ๆ`,
    );
  });
});
