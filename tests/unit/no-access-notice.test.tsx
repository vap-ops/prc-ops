// Spec 192 U3 — when a project exists but the caller isn't on its team
// (can_see_project = member OR lead, ADR 0056), the page used to 404. That's a
// dead-end: the locked-out person can't tell "no access" from "doesn't exist",
// and can't ask back in. NoAccessNotice explains it and points to the fix.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoAccessNotice } from "@/app/projects/[projectId]/no-access-notice";

describe("NoAccessNotice", () => {
  it("explains the caller isn't on the team and to contact the PM", () => {
    render(<NoAccessNotice />);
    expect(screen.getByText(/ยังไม่ได้อยู่ในทีม/)).toBeInTheDocument();
    expect(screen.getByText(/ติดต่อผู้จัดการโครงการ/)).toBeInTheDocument();
  });
});
