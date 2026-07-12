// Writing failing test first.
//
// Spec 299 U1 — the /sa/help hub card: a native <details> accordion (zero-JS server
// component) titled by the task, expanding to a "เมื่อไหร่ใช้" line + numbered steps +
// an optional tip. Carries a stable anchor id so a future per-screen "?" can deep-link
// (/sa/help#photos). Content is passed as data (HelpCard) — copy edits never touch this.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { HelpCard } from "@/components/features/sa/help/help-card";

const CARD = {
  id: "photos",
  title: "ถ่ายรูปงาน",
  whenToUse: "ทุกครั้งที่งานมีความคืบหน้า",
  steps: ["เปิดงานที่ทำ", "กดปุ่มถ่ายรูป", "ยืนยันว่ารูปผูกกับงาน"],
  tip: "ถ่ายให้เห็นงานชัด ๆ",
};

describe("HelpCard — spec 299 U1", () => {
  it("renders the title, when-to-use, every step, and the tip", () => {
    render(<HelpCard card={CARD} />);
    expect(screen.getByText("ถ่ายรูปงาน")).toBeInTheDocument();
    expect(screen.getByText(/ทุกครั้งที่งานมีความคืบหน้า/)).toBeInTheDocument();
    for (const step of CARD.steps) {
      expect(screen.getByText(new RegExp(step))).toBeInTheDocument();
    }
    expect(screen.getByText(/ถ่ายให้เห็นงานชัด/)).toBeInTheDocument();
  });

  it("carries the anchor id for deep-linking", () => {
    const { container } = render(<HelpCard card={CARD} />);
    expect(container.querySelector("#photos")).not.toBeNull();
  });

  it("omits the tip block when a card has no tip", () => {
    render(
      <HelpCard
        card={{ id: "notip", title: "หัวข้อ", whenToUse: "เมื่อไหร่", steps: ["ขั้นตอน"] }}
      />,
    );
    expect(screen.queryByText(/ถ่ายให้เห็นงานชัด/)).toBeNull();
  });
});
