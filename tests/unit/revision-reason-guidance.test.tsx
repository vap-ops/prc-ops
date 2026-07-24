// Spec 355 U3 — the SA-side guidance SSOT + the attention-card note.
//
// REVISION_REASON_GUIDANCE turns the PM's structured reject-evidence reason
// (incomplete / mismatch / premature) into the SA's correct next action; the
// WP-detail attention card renders it through <RevisionReasonGuidance>. The
// completeness sweep iterates the GENERATED enum array (not a hand list), so a
// new enum value reds this file before it can ship unguided.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RevisionReasonGuidance } from "@/components/features/work-packages/revision-reason-guidance";
import { Constants } from "@/lib/db/database.types";
import { APPROVAL_REVISION_REASON_LABEL, REVISION_REASON_GUIDANCE } from "@/lib/i18n/labels";

const THAI_CHAR = /[฀-๿]/;
const REASONS = Constants.public.Enums.approval_revision_reason;

describe("REVISION_REASON_GUIDANCE — SSOT completeness (spec 355 U3)", () => {
  it("covers every approval_revision_reason with distinct Thai cta + guidance", () => {
    for (const reason of REASONS) {
      const g = REVISION_REASON_GUIDANCE[reason];
      expect(g, `${reason} missing`).toBeTruthy();
      expect(g.cta, `${reason}.cta not Thai`).toMatch(THAI_CHAR);
      expect(g.guidance, `${reason}.guidance not Thai`).toMatch(THAI_CHAR);
    }
    expect(new Set(REASONS.map((r) => REVISION_REASON_GUIDANCE[r].cta)).size).toBe(REASONS.length);
    expect(new Set(REASONS.map((r) => REVISION_REASON_GUIDANCE[r].guidance)).size).toBe(
      REASONS.length,
    );
  });

  it("mismatch tells the SA to REMOVE and re-shoot, not add more", () => {
    expect(REVISION_REASON_GUIDANCE.mismatch.cta).toContain("ลบ");
    expect(REVISION_REASON_GUIDANCE.mismatch.cta).toContain("ถ่ายใหม่");
    expect(REVISION_REASON_GUIDANCE.premature.guidance).toContain("เสร็จ");
  });
});

describe("<RevisionReasonGuidance> — per-reason attention-card note", () => {
  it("mismatch: reason chip + guidance + a #wp-photos CTA carrying the mismatch cta", () => {
    render(<RevisionReasonGuidance reason="mismatch" showCta />);
    expect(screen.getByText(APPROVAL_REVISION_REASON_LABEL.mismatch)).toBeInTheDocument();
    expect(screen.getByText(REVISION_REASON_GUIDANCE.mismatch.guidance)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: REVISION_REASON_GUIDANCE.mismatch.cta });
    expect(link).toHaveAttribute("href", "#wp-photos");
    // The generic 353 phase CTA must NOT render on a reasoned card.
    expect(screen.queryByText("ถ่ายรูปหลังทำงานใหม่")).not.toBeInTheDocument();
    expect(screen.queryByText("ถ่ายรูปหลังแก้ไขใหม่")).not.toBeInTheDocument();
  });

  it("incomplete: its own cta links to the capture zone", () => {
    render(<RevisionReasonGuidance reason="incomplete" showCta />);
    const link = screen.getByRole("link", { name: REVISION_REASON_GUIDANCE.incomplete.cta });
    expect(link).toHaveAttribute("href", "#wp-photos");
  });

  it("premature: guidance only — the next action is finishing the work, not a photo jump", () => {
    render(<RevisionReasonGuidance reason="premature" showCta />);
    expect(screen.getByText(REVISION_REASON_GUIDANCE.premature.guidance)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("showCta=false (read-only viewer): the chip + guidance stay, the action link goes", () => {
    render(<RevisionReasonGuidance reason="mismatch" showCta={false} />);
    expect(screen.getByText(REVISION_REASON_GUIDANCE.mismatch.guidance)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
