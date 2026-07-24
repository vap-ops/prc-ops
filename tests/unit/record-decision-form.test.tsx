// Writing failing test first.
//
// Spec 337 F3 changed what the third decision DOES: `rejected` used to record a
// comment and change nothing (0 uses ever, semantics undefined); it now sends
// the WORK back — the WP flips to งานแก้ไข, its rework round advances, and it
// leaves the review queue. A PM choosing between "ให้แก้ไข" (re-shoot the
// photos, item stays in the queue) and this one is choosing between two very
// different outcomes, so the option must NAME the outcome. Nothing else pins
// this copy, and a label that lies about behaviour is exactly the defect class
// this unit exists to remove.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/review/work-packages/[workPackageId]/actions", () => ({
  recordDecision: vi.fn(),
}));

import { RecordDecisionForm } from "@/app/review/work-packages/[workPackageId]/record-decision-form";
import { APPROVAL_DECISION_LABEL } from "@/lib/i18n/labels";

const WP = "11111111-1111-4111-8111-111111111111";

// Spec 353 — sharpen the two rejections on the evidence-vs-work axis, and single-
// source the labels: the SA's attention card, /review and notifications all read
// APPROVAL_DECISION_LABEL, so the form must render the SAME strings for the two
// rejections (the pre-353 form said "ส่งกลับแก้งาน" while the shared map still said
// the stale "ไม่อนุมัติ" — a contradiction the SA saw).
describe("RecordDecisionForm — spec 353 sharpened rejection framing", () => {
  it("names the reject-evidence choice as a photo re-shoot, work untouched", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.getByText("ถ่ายรูปใหม่")).toBeInTheDocument();
    expect(screen.getByText(/งานไม่ต้องแก้/)).toBeInTheDocument();
    expect(screen.getByText(/ยังอยู่ในคิวตรวจ/)).toBeInTheDocument();
  });

  it("names the reject-work choice and where the WP lands", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.getByText("ส่งกลับแก้งาน")).toBeInTheDocument();
    expect(screen.getByText(/จะกลับไปเป็นงานแก้ไข/)).toBeInTheDocument();
  });

  it("retires the stale ไม่อนุมัติ and the vague ให้แก้ไข labels", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.queryByText("ไม่อนุมัติ")).not.toBeInTheDocument();
    expect(screen.queryByText("ให้แก้ไข")).not.toBeInTheDocument();
  });

  it("single-sources the two rejection labels through APPROVAL_DECISION_LABEL", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.getByText(APPROVAL_DECISION_LABEL.needs_revision)).toBeInTheDocument();
    expect(screen.getByText(APPROVAL_DECISION_LABEL.rejected)).toBeInTheDocument();
    // Pin the sharpened SSOT values so the map cannot silently drift back.
    expect(APPROVAL_DECISION_LABEL.needs_revision).toBe("ถ่ายรูปใหม่");
    expect(APPROVAL_DECISION_LABEL.rejected).toBe("ส่งกลับแก้งาน");
  });

  it("offers exactly the three decisions", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});

// Spec 353 D7 — the SA's attention-card re-shoot CTA names the evidence phase the
// PM's decision points at, instead of a generic "ถ่ายรูปเพิ่ม": after_fix once the WP
// is a rework cycle (rework_round>0), else the after photo. (Page-source pin — the
// CTA lives in the RSC WP-detail page, not the form.)
describe("WP-detail re-shoot CTA (spec 353 D7)", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
    "utf8",
  );
  it("names after_fix (reworked) vs after (round-0), retiring the generic label", () => {
    expect(pageSrc).toContain(
      'wp.rework_round > 0 ? "ถ่ายรูปหลังแก้ไขใหม่" : "ถ่ายรูปหลังทำงานใหม่"',
    );
    expect(pageSrc).not.toContain("ถ่ายรูปเพิ่ม");
  });
});

// Spec 355 — reject-evidence carries a required structured reason. The chips appear
// only for needs_revision, and submit is gated until one is picked (comment optional).
describe("RecordDecisionForm — spec 355 revision-reason chips", () => {
  it("shows the three reason chips only when needs_revision is picked", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    // no reason chips before a decision is chosen
    expect(screen.queryByText("รูปไม่ตรงกับงาน")).not.toBeInTheDocument();
    // pick needs_revision (radio order = approved, needs_revision, rejected)
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    expect(screen.getByText("รูปไม่ครบ")).toBeInTheDocument();
    expect(screen.getByText("รูปไม่ตรงกับงาน")).toBeInTheDocument();
    expect(screen.getByText("งานยังไม่เสร็จ")).toBeInTheDocument();
  });

  it("gates submit until a reason is picked (comment optional)", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    const submit = screen.getByRole("button", { name: /บันทึกผลการตรวจ/ });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByText("รูปไม่ตรงกับงาน"));
    expect(submit).toBeEnabled();
  });

  it("hides the reason chips for approved and reject-work (rejected)", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    fireEvent.click(screen.getAllByRole("radio")[2]!); // rejected
    expect(screen.queryByText("รูปไม่ตรงกับงาน")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("radio")[0]!); // approved
    expect(screen.queryByText("รูปไม่ตรงกับงาน")).not.toBeInTheDocument();
  });
});
