// Spec 334 U1 — the วันนี้ hero <MusterTodayCard>. Presentational (no data
// fetch): takes a MusterDaySummary + the project name/date and renders the
// headline count and one action per state. The state table in the spec is the
// contract; every row is pinned here, plus the two zero guards. The CTA always
// links to musterHref(projectId) — the cockpit is the single write path.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MusterTodayCard } from "@/components/features/sa/muster-today-card";
import { musterHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { MUSTER_DAY_CLOSED_LABEL } from "@/lib/i18n/labels";
import type { MusterDaySummary } from "@/lib/muster/day-summary";

// Spec 334 follow-up: every hero CTA threads ?from=/team so the cockpit's back
// chip returns HERE, not to the project page (the multi-parent back-chip class).
const HREF = withBackFrom(musterHref("p1"), "/team");

function renderCard(summary: MusterDaySummary) {
  return render(
    <MusterTodayCard
      summary={summary}
      projectId="p1"
      projectName="TFM โพธิ์ทอง"
      dateLabel="21 ก.ค. 2569"
    />,
  );
}

const NOT_STARTED: MusterDaySummary = {
  state: "not_started",
  present: 0,
  expected: 25,
  closedAt: null,
};
const OPEN: MusterDaySummary = { state: "open", present: 12, expected: 25, closedAt: null };
const CLOSED: MusterDaySummary = {
  state: "closed",
  present: 18,
  expected: 25,
  closedAt: "2026-07-21T10:00:00Z",
};

describe("MusterTodayCard", () => {
  it("not_started → 0 / 25 มาทำงาน + the empty-day sub-line, primary เริ่มเช็คชื่อ CTA", () => {
    const { container } = renderCard(NOT_STARTED);
    expect(container.textContent).toContain("0 / 25 มาทำงาน");
    expect(container.textContent).toContain("ยังไม่มีใครเช็คชื่อวันนี้");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", HREF);
    expect(link.textContent).toContain("เริ่มเช็คชื่อ");
  });

  it("shows the project name and Bangkok date line", () => {
    const { container } = renderCard(NOT_STARTED);
    expect(container.textContent).toContain("TFM โพธิ์ทอง");
    expect(container.textContent).toContain("21 ก.ค. 2569");
  });

  it("open → 12 / 25 มาทำงาน, primary ไปหน้าเช็คชื่อ CTA (distinct from not_started)", () => {
    const { container } = renderCard(OPEN);
    expect(container.textContent).toContain("12 / 25 มาทำงาน");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", HREF);
    expect(link.textContent).toContain("ไปหน้าเช็คชื่อ");
    expect(link.textContent).not.toContain("เริ่มเช็คชื่อ");
  });

  it("closed → ปิดวันแล้ว · มาทำงาน 18 คน, quiet ดูรายละเอียด CTA", () => {
    const { container } = renderCard(CLOSED);
    expect(container.textContent).toContain(MUSTER_DAY_CLOSED_LABEL);
    expect(container.textContent).toContain("มาทำงาน 18 คน");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", HREF);
    expect(link.textContent).toContain("ดูรายละเอียด");
  });

  it("expected === 0 → ยังไม่มีช่างในโครงการนี้ replaces the count; CTA still renders", () => {
    const { container } = renderCard({
      state: "not_started",
      present: 0,
      expected: 0,
      closedAt: null,
    });
    expect(container.textContent).toContain("ยังไม่มีช่างในโครงการนี้");
    expect(container.textContent).not.toContain("/"); // no denominator when there are no workers
    // Review fix (spec U1 zero-worker row): the no-workers headline REPLACES the
    // whole count block — the "no one checked in yet" sub-line would be redundant.
    expect(container.textContent).not.toContain("ยังไม่มีใครเช็คชื่อวันนี้");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", HREF);
    expect(link.textContent).toContain("เริ่มเช็คชื่อ");
  });

  it("closed with zero attendance → ปิดวันแล้ว · ไม่มีคนมาทำงาน, quiet CTA", () => {
    const { container } = renderCard({
      state: "closed",
      present: 0,
      expected: 25,
      closedAt: "2026-07-21T10:00:00Z",
    });
    expect(container.textContent).toContain(MUSTER_DAY_CLOSED_LABEL);
    expect(container.textContent).toContain("ไม่มีคนมาทำงาน");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", HREF);
    expect(link.textContent).toContain("ดูรายละเอียด");
  });
});
