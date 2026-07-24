// Spec 353 — the SA's ต้องแก้ไข worklist (SaActionSection) is a THIRD home for the
// WP-decision framing (KIND_META chips). It must single-source the two decision
// chips through APPROVAL_DECISION_LABEL so it cannot drift from the PM form and the
// attention card — the exact drift spec 337 F3 left here as the stale "ไม่อนุมัติ".

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SaActionSection } from "@/components/features/sa/action-section";
import { APPROVAL_DECISION_LABEL } from "@/lib/i18n/labels";
import type { SaActionItem } from "@/lib/sa/action-list";

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
    ...over,
  };
}

describe("SaActionSection — spec 353 single-sourced decision chips", () => {
  it("labels a revision (reject-evidence) row from APPROVAL_DECISION_LABEL", () => {
    render(<SaActionSection items={[item({ id: "a", kind: "revision" })]} />);
    expect(screen.getByText(APPROVAL_DECISION_LABEL.needs_revision)).toBeInTheDocument();
    expect(screen.getByText("ถ่ายรูปใหม่")).toBeInTheDocument();
  });

  it("labels a rejected (reject-work) row from the SSOT, not the stale ไม่อนุมัติ", () => {
    render(<SaActionSection items={[item({ id: "b", kind: "rejected" })]} />);
    expect(screen.getByText(APPROVAL_DECISION_LABEL.rejected)).toBeInTheDocument();
    expect(screen.queryByText("ไม่อนุมัติ")).not.toBeInTheDocument();
  });

  it("keeps the rework status chip (งานแก้ไข) — a status, not a decision", () => {
    render(<SaActionSection items={[item({ id: "c", kind: "rework", round: 1 })]} />);
    expect(screen.getByText(/งานแก้ไข/)).toBeInTheDocument();
  });
});
