// Spec 201 U1 — MyFeedbackList renders a reporter's own submissions with status.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  MyFeedbackList,
  type MyFeedbackItem,
} from "@/components/features/feedback/my-feedback-list";
import { FEEDBACK_TYPE_LABEL, FEEDBACK_STATUS_LABEL } from "@/lib/i18n/labels";

const items: MyFeedbackItem[] = [
  // deliberately out of date order — the list must re-sort newest-first
  {
    id: "a",
    type: "bug",
    status: "open",
    title: "เพิ่มรูปไม่ได้",
    createdAt: "2026-06-20T03:00:00Z",
  },
  {
    id: "b",
    type: "feature",
    status: "done",
    title: "ขอเพิ่มกลุ่มวัสดุ",
    createdAt: "2026-06-24T03:00:00Z",
  },
  {
    id: "c",
    type: "bug",
    status: "in_progress",
    title: "ปุ่มออกจากระบบซ้ำ",
    createdAt: "2026-06-22T03:00:00Z",
  },
];

describe("MyFeedbackList (spec 201)", () => {
  it("renders each submission's title", () => {
    render(<MyFeedbackList items={items} />);
    expect(screen.getByText("เพิ่มรูปไม่ได้")).toBeInTheDocument();
    expect(screen.getByText("ขอเพิ่มกลุ่มวัสดุ")).toBeInTheDocument();
    expect(screen.getByText("ปุ่มออกจากระบบซ้ำ")).toBeInTheDocument();
  });

  it("badges each submission's type and status", () => {
    render(<MyFeedbackList items={items} />);
    // two bugs + one feature
    expect(screen.getAllByText(FEEDBACK_TYPE_LABEL.bug)).toHaveLength(2);
    expect(screen.getAllByText(FEEDBACK_TYPE_LABEL.feature)).toHaveLength(1);
    // distinct statuses
    expect(screen.getByText(FEEDBACK_STATUS_LABEL.open)).toBeInTheDocument();
    expect(screen.getByText(FEEDBACK_STATUS_LABEL.done)).toBeInTheDocument();
    expect(screen.getByText(FEEDBACK_STATUS_LABEL.in_progress)).toBeInTheDocument();
  });

  it("orders submissions newest-first regardless of input order", () => {
    const { container } = render(<MyFeedbackList items={items} />);
    const text = container.textContent ?? "";
    // newest (06-24) → 06-22 → oldest (06-20)
    expect(text.indexOf("ขอเพิ่มกลุ่มวัสดุ")).toBeLessThan(text.indexOf("ปุ่มออกจากระบบซ้ำ"));
    expect(text.indexOf("ปุ่มออกจากระบบซ้ำ")).toBeLessThan(text.indexOf("เพิ่มรูปไม่ได้"));
  });

  it("renders an empty state when the reporter has no submissions", () => {
    render(<MyFeedbackList items={[]} />);
    expect(screen.getByText(/ยังไม่มีเรื่องที่เคยแจ้ง/)).toBeInTheDocument();
  });
});
