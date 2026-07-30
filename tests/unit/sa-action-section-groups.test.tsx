// Writing failing test first.
//
// Spec 384 U1 — the ต้องแก้ไข section renders the PM's sweep as collapsible
// per-reason groups above nothing at all, with the rows nobody came back to banded
// out and always open.
//
// Every branch this section renders gets an assertion that dies with it — the
// spec-371 lesson: a guard with 13 assertions still let a whole zone be deleted
// green, because nothing named it.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SaActionSection } from "@/components/features/sa/action-section";
import { staleCutoffIso, STALE_ACTION_DAYS, type SaActionItem } from "@/lib/sa/action-list";
import {
  APPROVAL_DECISION_LABEL,
  APPROVAL_REVISION_REASON_LABEL,
  staleActionBandLabel,
} from "@/lib/i18n/labels";

const NOW = Date.parse("2026-07-31T09:00:00.000Z");
const CUTOFF = staleCutoffIso(NOW);

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString().replace("Z", "+00:00");
}

function item(over: Partial<SaActionItem> & Pick<SaActionItem, "id" | "kind">): SaActionItem {
  return {
    code: over.id.toUpperCase(),
    name: `งาน ${over.id}`,
    projectId: "p1",
    projectCode: "PRC-01",
    projectName: "โครงการ",
    reason: null,
    source: null,
    round: null,
    revisionReason: null,
    sinceIso: daysAgo(1),
    ...over,
  };
}

/** A fresh batch of `n` rows sharing one reason — the live shape (16 incomplete). */
function sweep(n: number, revisionReason: SaActionItem["revisionReason"]): SaActionItem[] {
  return Array.from({ length: n }, (_, i) =>
    item({ id: `s${i}`, kind: "revision", revisionReason, sinceIso: daysAgo(1) }),
  );
}

describe("SaActionSection — spec 384 collapsed reason groups", () => {
  it("collapses a sweep behind one row and expands it on tap", () => {
    render(<SaActionSection items={sweep(16, "incomplete")} staleBeforeIso={CUTOFF} />);

    const toggle = screen.getByRole("button", {
      name: new RegExp(APPROVAL_REVISION_REASON_LABEL.incomplete),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed means the 16 cards are not in the document at all — not merely
    // hidden. This is the whole ~6,000px → ~700px claim.
    expect(screen.queryByText("งาน s0")).not.toBeInTheDocument();
    expect(screen.getByText("16 งาน")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("งาน s0")).toBeInTheDocument();
    expect(screen.getByText("งาน s15")).toBeInTheDocument();
  });

  it("renders a group of 3 or fewer OPEN, with no toggle to press", () => {
    // Hiding two cards behind a chevron costs more than it saves, and `rework` is
    // a 2-row group on live data today.
    render(<SaActionSection items={sweep(3, "mismatch")} staleBeforeIso={CUTOFF} />);

    expect(screen.getByText("งาน s0")).toBeInTheDocument();
    expect(screen.getByText("งาน s2")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(APPROVAL_REVISION_REASON_LABEL.mismatch),
      }),
    ).not.toBeInTheDocument();
    // The heading still names the group, so an open group is self-describing.
    // Queried by ROLE: every card inside also carries the reason on its chip, and
    // a bare text query cannot tell the heading from the three chips under it.
    expect(
      screen.getByRole("heading", { name: new RegExp(APPROVAL_REVISION_REASON_LABEL.mismatch) }),
    ).toBeInTheDocument();
  });

  it("labels a reasonless group from the decision SSOT, not a bespoke string", () => {
    render(
      <SaActionSection
        items={Array.from({ length: 5 }, (_, i) =>
          item({ id: `n${i}`, kind: "revision", sinceIso: daysAgo(1) }),
        )}
        staleBeforeIso={CUTOFF}
      />,
    );
    expect(
      screen.getByRole("button", { name: new RegExp(APPROVAL_DECISION_LABEL.needs_revision) }),
    ).toBeInTheDocument();
  });
});

describe("SaActionSection — spec 384 the stale band", () => {
  it("shows the band open, above the groups, with its own count", () => {
    render(
      <SaActionSection
        items={[
          ...sweep(16, "incomplete"),
          item({ id: "old1", kind: "revision", sinceIso: daysAgo(9) }),
          item({ id: "old2", kind: "revision", sinceIso: daysAgo(7) }),
        ]}
        staleBeforeIso={CUTOFF}
      />,
    );

    expect(screen.getByText(staleActionBandLabel(STALE_ACTION_DAYS, 2))).toBeInTheDocument();
    // Banded rows are ALWAYS rendered — they are the ones being dropped.
    expect(screen.getByText("งาน old1")).toBeInTheDocument();
    expect(screen.getByText("งาน old2")).toBeInTheDocument();
    // …while the fresh sweep beside them is still collapsed.
    expect(screen.queryByText("งาน s0")).not.toBeInTheDocument();
  });

  it("renders no band when nothing is stale", () => {
    render(<SaActionSection items={sweep(5, "incomplete")} staleBeforeIso={CUTOFF} />);
    expect(screen.queryByText(new RegExp("ค้างเกิน"))).not.toBeInTheDocument();
  });

  it("counts EVERY row in the section header, banded and collapsed alike", () => {
    // The header count is the SA's only signal of how much is outstanding; if it
    // followed what is visible it would shrink as she collapses her own work away.
    render(
      <SaActionSection
        items={[
          ...sweep(16, "incomplete"),
          item({ id: "old", kind: "rework", sinceIso: daysAgo(9) }),
        ]}
        staleBeforeIso={CUTOFF}
      />,
    );
    expect(screen.getByText("17")).toBeInTheDocument();
  });

  it("renders nothing at all for an empty list", () => {
    const { container } = render(<SaActionSection items={[]} staleBeforeIso={CUTOFF} />);
    expect(container).toBeEmptyDOMElement();
  });
});
