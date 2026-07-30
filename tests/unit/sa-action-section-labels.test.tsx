// Spec 353 — the SA's ต้องแก้ไข worklist (SaActionSection) is a THIRD home for the
// WP-decision framing (KIND_META chips). It must single-source the two decision
// chips through APPROVAL_DECISION_LABEL so it cannot drift from the PM form and the
// attention card — the exact drift spec 337 F3 left here as the stale "ไม่อนุมัติ".

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SaActionSection } from "@/components/features/sa/action-section";
import {
  APPROVAL_DECISION_LABEL,
  APPROVAL_REVISION_REASON_LABEL,
  REVISION_REASON_GUIDANCE,
} from "@/lib/i18n/labels";
import type { SaActionItem } from "@/lib/sa/action-list";

// Spec 384 U1 — the section now bands rows older than a cutoff out of their reason
// group. These cases are about the CARD, so every fixture carries no age at all:
// an unknown age is never stale, so each row lands in a one-member group, which
// renders open. The card markup under test is reached unchanged either way.
/** The single rendered card. Scoped so a chip assertion cannot be satisfied by
 *  the GROUP HEADING above it — both read the same SSOT, which is the point of
 *  spec 353, and an unscoped query would pass on a card that lost its chip. */
const row = () => within(screen.getByRole("listitem"));

const CUTOFF = "2026-07-28T09:00:00.000Z";

function item(over: Partial<SaActionItem> & Pick<SaActionItem, "id" | "kind">): SaActionItem {
  return {
    code: "W05-03",
    name: "งานฉาบผนัง",
    projectId: "p1",
    projectCode: "PRC-01",
    projectName: "โครงการ",
    reason: null,
    source: null,
    round: null,
    revisionReason: null,
    sinceIso: null,
    ...over,
  };
}

describe("SaActionSection — spec 353 single-sourced decision chips", () => {
  it("labels a revision (reject-evidence) row from APPROVAL_DECISION_LABEL", () => {
    render(
      <SaActionSection items={[item({ id: "a", kind: "revision" })]} staleBeforeIso={CUTOFF} />,
    );
    // Both the group heading and the row chip read the same SSOT, so the label
    // appears twice — the point of the assertion is that it is THIS string.
    expect(row().getByText(APPROVAL_DECISION_LABEL.needs_revision)).toBeInTheDocument();
    expect(row().getByText("ถ่ายรูปใหม่")).toBeInTheDocument();
  });

  it("labels a rejected (reject-work) row from the SSOT, not the stale ไม่อนุมัติ", () => {
    render(
      <SaActionSection items={[item({ id: "b", kind: "rejected" })]} staleBeforeIso={CUTOFF} />,
    );
    expect(row().getByText(APPROVAL_DECISION_LABEL.rejected)).toBeInTheDocument();
    expect(screen.queryByText("ไม่อนุมัติ")).not.toBeInTheDocument();
  });

  it("keeps the rework status chip (งานแก้ไข) — a status, not a decision", () => {
    render(
      <SaActionSection
        items={[item({ id: "c", kind: "rework", round: 1 })]}
        staleBeforeIso={CUTOFF}
      />,
    );
    expect(row().getByText(/งานแก้ไข/)).toBeInTheDocument();
  });
});

// Spec 355 U3 — a reasoned bounce tells the SA WHY on the chip and swaps the row
// CTA to the per-reason action; leaving the generic "ถ่ายรูปเพิ่ม" on a mismatch
// row would repeat the exact wrong-instruction bug the spec exists to kill.
// Fresh-eyes: the chip is the REASON ALONE (not "ถ่ายรูปใหม่ · งานยังไม่เสร็จ" —
// self-contradictory for premature), and premature drops the camera + photo-anchor
// affordance (its action is finishing the work, not jumping to the capture zone).
describe("SaActionSection — spec 355 revision reason on the worklist row", () => {
  it("mismatch: chip is the reason label; CTA is remove-and-reshoot; row anchors #wp-photos", () => {
    render(
      <SaActionSection
        items={[item({ id: "a", kind: "revision", revisionReason: "mismatch" })]}
        staleBeforeIso={CUTOFF}
      />,
    );
    expect(row().getByText(APPROVAL_REVISION_REASON_LABEL.mismatch)).toBeInTheDocument();
    // The generic decision umbrella must NOT prefix a reasoned chip.
    expect(screen.queryByText(/ถ่ายรูปใหม่ ·/)).not.toBeInTheDocument();
    expect(screen.getByText(REVISION_REASON_GUIDANCE.mismatch.cta)).toBeInTheDocument();
    expect(screen.queryByText("ถ่ายรูปเพิ่ม")).not.toBeInTheDocument();
    expect(screen.getByRole("link").getAttribute("href")).toContain("#wp-photos");
  });

  it("a reasonless (historical) revision row keeps the generic chip + CTA", () => {
    render(
      <SaActionSection items={[item({ id: "b", kind: "revision" })]} staleBeforeIso={CUTOFF} />,
    );
    expect(row().getByText(APPROVAL_DECISION_LABEL.needs_revision)).toBeInTheDocument();
    expect(screen.getByText("ถ่ายรูปเพิ่ม")).toBeInTheDocument();
    expect(screen.getByRole("link").getAttribute("href")).toContain("#wp-photos");
  });

  it("premature: finish-the-work CTA, no camera icon, row lands on the WP detail not the capture zone", () => {
    const { container } = render(
      <SaActionSection
        items={[item({ id: "c", kind: "revision", revisionReason: "premature" })]}
        staleBeforeIso={CUTOFF}
      />,
    );
    expect(row().getByText(APPROVAL_REVISION_REASON_LABEL.premature)).toBeInTheDocument();
    expect(screen.getByText(REVISION_REASON_GUIDANCE.premature.cta)).toBeInTheDocument();
    expect(screen.queryByText("ถ่ายรูปเพิ่ม")).not.toBeInTheDocument();
    expect(screen.getByRole("link").getAttribute("href")).not.toContain("#wp-photos");
    expect(container.querySelector("svg.lucide-camera")).toBeNull();
  });
});
