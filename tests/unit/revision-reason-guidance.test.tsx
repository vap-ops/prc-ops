// Spec 355 U3 — the SA-side guidance SSOT + the attention-card note.
//
// REVISION_REASON_GUIDANCE turns the PM's structured reject-evidence reason
// (incomplete / mismatch / premature) into the SA's correct next action; the
// WP-detail attention card renders it through <RevisionReasonGuidance>. The
// completeness sweep iterates the GENERATED enum array (not a hand list), so a
// new enum value reds this file before it can ship unguided.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RevisionReasonGuidance } from "@/components/features/work-packages/revision-reason-guidance";
import { Constants } from "@/lib/db/database.types";
import { REVISION_REASON_GUIDANCE } from "@/lib/i18n/labels";

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
  it("mismatch: guidance + a #wp-photos CTA carrying the mismatch cta", () => {
    render(<RevisionReasonGuidance reason="mismatch" showCta />);
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

// The WP-detail page is an RSC too heavy to render here, so pin its WIRING at the
// source (repo precedent: record-decision-form's spec-353 CTA pin). ≥2 occurrences
// = import PLUS a real JSX usage — an import alone must not satisfy this
// (doctrine: assertions on file text pin usage, not presence).
describe("WP-detail page wiring (spec 355 U3)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
    "utf8",
  );

  it("renders RevisionReasonGuidance gated on a needs_revision reason, read-only + answered aware", () => {
    expect(src.split("RevisionReasonGuidance").length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain('attention.decision === "needs_revision" && attention.revision_reason');
    // Fresh-eyes: once the SA has answered the bounce (ส่งตรวจอีกครั้ง) the
    // spec-291 delete window is CLOSED — a "ลบรูป…" CTA would offer-then-refuse,
    // so the action gates on the answered state too (guidance text stays).
    expect(src).toContain("showCta={!readOnly && !attentionAnswered}");
  });

  it("titles the reasoned card with the REASON, not the generic decision umbrella", () => {
    // "ถ่ายรูปใหม่" as the header over a premature ("finish the work first")
    // guidance is a self-contradiction — the reasoned card leads with WHY.
    expect(src).toContain("APPROVAL_REVISION_REASON_LABEL[attention.revision_reason]");
  });

  it("keeps the spec-353 phase CTA as the null-reason fallback", () => {
    expect(src).toContain('wp.rework_round > 0 ? "ถ่ายรูปหลังแก้ไขใหม่" : "ถ่ายรูปหลังทำงานใหม่"');
  });
});
