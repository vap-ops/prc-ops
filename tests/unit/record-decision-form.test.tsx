// Writing failing test first.
//
// Spec 372 U2 — the PM stops choosing a MECHANISM and describes what is WRONG.
//
// Before: three peer radios that were not on one axis — "ถ่ายรูปใหม่" instructs the
// SA, "ส่งกลับแก้งาน" describes the PM's own action — with the reason chips hidden
// one level down inside the middle one. Measured consequence: `rejected` was used
// **0 times in five weeks**, and `premature` ("งานยังไม่เสร็จ", which means the WORK)
// also sat at 0, because it had a home inside the OTHER button.
//
// After: อนุมัติ / ไม่อนุมัติ, then four causes on ONE axis, each naming a problem.
// The system maps the cause to the decision + reason the RPC expects.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const recordDecision = vi.fn();
vi.mock("@/app/review/work-packages/[workPackageId]/actions", () => ({
  recordDecision: (...args: unknown[]) => recordDecision(...args),
}));

import { RecordDecisionForm } from "@/app/review/work-packages/[workPackageId]/record-decision-form";
import { APPROVAL_DECISION_LABEL, APPROVAL_REVISION_REASON_LABEL } from "@/lib/i18n/labels";

const WP = "11111111-1111-4111-8111-111111111111";

const pickNotApproved = () => fireEvent.click(screen.getByRole("radio", { name: /ไม่อนุมัติ/ }));
const cause = (name: RegExp) => screen.getByRole("radio", { name });
const submitButton = () => screen.getByRole("button", { name: /บันทึกผลการตรวจ/ });

beforeEach(() => {
  recordDecision.mockReset();
  recordDecision.mockResolvedValue({ ok: true });
});

describe("RecordDecisionForm — one question, then the cause (spec 372 U2)", () => {
  it("asks one question first: approve or not", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    // ^ anchored: /อนุมัติ/ alone also matches ไม่อนุมัติ.
    expect(screen.getByRole("radio", { name: /^อนุมัติ/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ไม่อนุมัติ/ })).toBeInTheDocument();
    // The causes are a SECOND step — none of them is offered up front.
    expect(screen.queryByRole("radio", { name: /รูปไม่ครบ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /งานต้องแก้ไข/ })).not.toBeInTheDocument();
  });

  it("offers all FOUR causes once ไม่อนุมัติ is picked — including the work one", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    expect(cause(/รูปไม่ครบ/)).toBeInTheDocument();
    expect(cause(/รูปไม่ตรงกับงาน/)).toBeInTheDocument();
    expect(cause(/งานยังไม่เสร็จ/)).toBeInTheDocument();
    // The one that was a peer radio nobody ever pressed — now a cause among causes.
    expect(cause(/งานต้องแก้ไข/)).toBeInTheDocument();
  });

  it("shows no causes when the WP is approved", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    fireEvent.click(screen.getByRole("radio", { name: /^อนุมัติ/ }));
    expect(screen.queryByRole("radio", { name: /รูปไม่ครบ/ })).not.toBeInTheDocument();
  });

  it("retires the mechanism-shaped choices — no option instructs the SA or names an action", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    // "ถ่ายรูปใหม่" told the SA what to do; "ส่งกลับแก้งาน" described the PM's action.
    // Neither is a description of what is WRONG, which is all this form now asks.
    expect(screen.queryByRole("radio", { name: /ถ่ายรูปใหม่/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /ส่งกลับแก้งาน/ })).not.toBeInTheDocument();
  });

  it("single-sources every cause label — three reasons plus the decision SSOT", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    for (const r of ["incomplete", "mismatch", "premature"] as const) {
      expect(cause(new RegExp(APPROVAL_REVISION_REASON_LABEL[r]))).toBeInTheDocument();
    }
    expect(cause(new RegExp(APPROVAL_DECISION_LABEL.rejected))).toBeInTheDocument();
    // Pin the renamed SSOT so it cannot drift back to the action-shaped wording.
    // The SA's chip, /review, the timeline and notifications all read this value,
    // so the PM's choice and what the SA later sees stay the same words.
    expect(APPROVAL_DECISION_LABEL.rejected).toBe("งานต้องแก้ไข");
  });
});

describe("RecordDecisionForm — consequences in plain words (spec 372 U2)", () => {
  it("says the two PHOTO causes keep the WP in the review queue", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    // Spec 372 U3 narrowed this from three to two: งานยังไม่เสร็จ now LEAVES the
    // queue, so claiming it stays would be a lie the PM acts on.
    expect(screen.getAllByText(/ยังอยู่ในคิวตรวจ/)).toHaveLength(2);
  });

  it("says งานยังไม่เสร็จ sends the WP back to the site (spec 372 U3)", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    const row = cause(/งานยังไม่เสร็จ/).closest("label");
    expect(row).toHaveTextContent(/กลับไปเป็นงานที่กำลังทำ/);
    expect(row).not.toHaveTextContent(/ยังอยู่ในคิวตรวจ/);
  });

  it("says the work cause takes the WP OUT of the queue, back to site", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    expect(screen.getByText(/ออกจากคิวตรวจ/)).toBeInTheDocument();
    // …and no round counters or photo-bucket names in the hint the PM reads.
    expect(screen.queryByText(/รอบใหม่/)).not.toBeInTheDocument();
  });
});

describe("RecordDecisionForm — the cause drives the payload (spec 372 U2)", () => {
  it("sends needs_revision + the reason for a photo cause, comment optional", async () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    fireEvent.click(cause(/รูปไม่ตรงกับงาน/));
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());
    await vi.waitFor(() =>
      expect(recordDecision).toHaveBeenCalledWith({
        workPackageId: WP,
        decision: "needs_revision",
        comment: null,
        revisionReason: "mismatch",
      }),
    );
  });

  it("sends rejected with NO reason for the work cause — the RPC refuses one", async () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    fireEvent.click(cause(/งานต้องแก้ไข/));
    fireEvent.change(screen.getByLabelText(/ความเห็น/), { target: { value: "ผนังเอียง" } });
    fireEvent.click(submitButton());
    await vi.waitFor(() =>
      expect(recordDecision).toHaveBeenCalledWith({
        workPackageId: WP,
        decision: "rejected",
        comment: "ผนังเอียง",
        revisionReason: null,
      }),
    );
  });

  it("gates submit until a cause is chosen", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    expect(submitButton()).toBeDisabled();
    fireEvent.click(cause(/รูปไม่ครบ/));
    expect(submitButton()).toBeEnabled();
  });

  it("demands a comment for the work cause only — the RPC raises 22023 without one", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    fireEvent.click(cause(/งานต้องแก้ไข/));
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/ความเห็น/), { target: { value: "ผนังเอียง" } });
    expect(submitButton()).toBeEnabled();
  });

  it("clears a previously chosen cause when the PM switches back to อนุมัติ", async () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    fireEvent.click(cause(/รูปไม่ครบ/));
    fireEvent.click(screen.getByRole("radio", { name: /^อนุมัติ/ }));
    fireEvent.click(submitButton());
    // A stale reason riding an `approved` payload is exactly what the RPC rejects
    // (22023). Guaranteed by the `approve === false &&` guard on `payload`, NOT by
    // the state reset — mutation-checked: deleting the reset leaves this green, so
    // the reset's own behaviour is pinned separately below.
    await vi.waitFor(() =>
      expect(recordDecision).toHaveBeenCalledWith({
        workPackageId: WP,
        decision: "approved",
        comment: null,
        revisionReason: null,
      }),
    );
  });
});

describe("RecordDecisionForm — reversing the verdict re-asks the cause (spec 372 U2)", () => {
  it("forgets the cause on the way through อนุมัติ, so returning re-asks it", () => {
    render(<RecordDecisionForm workPackageId={WP} />);
    pickNotApproved();
    fireEvent.click(cause(/รูปไม่ครบ/));
    expect(submitButton()).toBeEnabled();

    // Switching to อนุมัติ is an explicit reversal of judgment. Coming back must not
    // leave the old cause pre-selected and submit already armed — the PM would be one
    // tap from recording a cause they had abandoned.
    fireEvent.click(screen.getByRole("radio", { name: /^อนุมัติ/ }));
    pickNotApproved();

    expect(cause(/รูปไม่ครบ/)).not.toBeChecked();
    expect(submitButton()).toBeDisabled();
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
