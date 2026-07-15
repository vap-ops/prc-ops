// Writing failing test first.
//
// Spec 322 — when an approver sends a registration back for edit, the row stays
// pending and the reviewer's note lands on reject_reason. The applicant workspace
// then shows THIS card (in place of the generic "sit tight" pending notice): a
// clear "action needed from you" heading + the note of what to fix. The edit form
// still renders below (gated only on pending), so she fixes and resubmits.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegistrationReturnedNotice } from "@/components/features/register/registration-returned-notice";

describe("RegistrationReturnedNotice", () => {
  it("tells the applicant to fix the listed items and resubmit", () => {
    render(<RegistrationReturnedNotice note={"- เอกสารไม่ครบ\n- รูปกลับด้านให้ตรง"} />);
    expect(screen.getByText("ต้องแก้ไขแล้วส่งใหม่")).toBeInTheDocument();
    // The reviewer's note is shown verbatim (line breaks preserved via whitespace-pre-line).
    expect(screen.getByText(/เอกสารไม่ครบ/)).toBeInTheDocument();
    expect(screen.getByText(/รูปกลับด้านให้ตรง/)).toBeInTheDocument();
  });

  it("reads as action-needed, not rejection (no 'ปฏิเสธ' wording)", () => {
    render(<RegistrationReturnedNotice note="แก้ตรงนี้" />);
    expect(screen.queryByText(/ปฏิเสธ/)).not.toBeInTheDocument();
  });
});
