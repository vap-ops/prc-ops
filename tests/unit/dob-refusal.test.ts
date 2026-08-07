import { describe, expect, it } from "vitest";

import { dobRefusalFact, DOB_MIN_AGE } from "@/lib/profile/dob-refusal";

// Spec 403 U1. The gate is live at the database, so a refused birth date already
// reaches users — and both call sites fall through to "บันทึกไม่สำเร็จ
// กรุณาลองใหม่อีกครั้ง". That is a lie: the same date will always fail. The repo
// already carries this rule (delivery-photo-storage-rls-fix-2026-07): a
// PERMANENT refusal must never say ลองใหม่.
//
// The mapper returns the FACT only, with no actor and no instruction. The two
// callers have different audiences — the person fixing their own birthday, and
// an approver who cannot fix it and must reject instead — so each supplies its
// own next step. A shared string that named one of them would be wrong for the
// other.
describe("dobRefusalFact", () => {
  it("names a Buddhist-era year as such and says how to convert it", () => {
    const fact = dobRefusalFact(
      "identity_change_requests.proposed_dob: dob looks like a buddhist era year",
    );
    expect(fact).toContain("พ.ศ.");
    expect(fact).toContain("543");
  });

  it("does not report a Buddhist-era year as merely a future date", () => {
    const fact = dobRefusalFact("workers.date_of_birth: dob looks like a buddhist era year");
    expect(fact).not.toContain("อนาคต");
  });

  it("names a future date", () => {
    expect(dobRefusalFact("workers.date_of_birth: dob in the future")).toContain("อนาคต");
  });

  it("states the age floor, and states the number the database actually enforces", () => {
    const fact = dobRefusalFact("workers.date_of_birth: dob under minimum age");
    expect(fact).toContain(String(DOB_MIN_AGE));
    expect(DOB_MIN_AGE).toBe(15);
  });

  it("names an implausibly old date without pretending to know the right one", () => {
    expect(dobRefusalFact("workers.date_of_birth: dob implausibly old")).toBeTruthy();
  });

  it("handles a non-finite date", () => {
    expect(dobRefusalFact("workers.date_of_birth: dob is not a real date")).toBeTruthy();
  });

  it("never tells the user to retry — the same date always fails", () => {
    for (const reason of [
      "dob looks like a buddhist era year",
      "dob in the future",
      "dob under minimum age",
      "dob implausibly old",
      "dob is not a real date",
    ]) {
      const fact = dobRefusalFact(`workers.date_of_birth: ${reason}`);
      expect(fact).not.toBeNull();
      expect(fact).not.toContain("ลองใหม่");
    }
  });

  it("prescribes no actor — the caller that knows the audience supplies the instruction", () => {
    for (const reason of ["dob looks like a buddhist era year", "dob under minimum age"]) {
      const fact = dobRefusalFact(`workers.date_of_birth: ${reason}`);
      expect(fact).not.toContain("ปฏิเสธ");
      expect(fact).not.toContain("ผู้อนุมัติ");
    }
  });

  it("returns null for anything that is not a DOB refusal, so other errors keep their own copy", () => {
    expect(dobRefusalFact("submit_identity_change: invalid national id")).toBeNull();
    expect(dobRefusalFact("some unrelated failure")).toBeNull();
    expect(dobRefusalFact("")).toBeNull();
  });
});
