// Writing failing test first.
//
// Spec 337 U2a — the ส่งตรวจอีกครั้ง control. It renders ONLY in the exact state
// pair the cure loop occupies (pending_approval + latest decision
// needs_revision), is disabled with a hint until the SA has actually re-shot,
// and turns into a calm confirmation once the bounce is answered — never a dead
// button that can only error (§0 dead-door rule).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { resubmit, refresh } = vi.hoisted(() => ({ resubmit: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  resubmitWorkPackageEvidence: resubmit,
}));

import { ResubmitEvidenceControl } from "@/app/projects/[projectId]/work-packages/[workPackageId]/resubmit-evidence-control";
import {
  RESUBMIT_LABEL,
  RESUBMIT_EVIDENCE_HINT,
  RESUBMIT_DONE_NOTE,
  type ResubmitState,
} from "@/lib/approvals/resubmit";

const WP = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function renderControl(state: ResubmitState) {
  return render(<ResubmitEvidenceControl projectId={PROJECT} workPackageId={WP} state={state} />);
}

beforeEach(() => {
  resubmit.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("ResubmitEvidenceControl", () => {
  it("renders nothing at all when the cure loop is not open", () => {
    const { container } = renderControl({ kind: "hidden" });
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the button when the re-shoot is done", () => {
    renderControl({ kind: "ready" });
    const button = screen.getByRole("button", { name: RESUBMIT_LABEL });
    expect(button).toBeEnabled();
    expect(screen.queryByText(RESUBMIT_EVIDENCE_HINT)).not.toBeInTheDocument();
  });

  it("disables the button and shows the hint until a new photo exists", () => {
    renderControl({ kind: "blocked", hint: RESUBMIT_EVIDENCE_HINT });
    expect(screen.getByRole("button", { name: RESUBMIT_LABEL })).toBeDisabled();
    expect(screen.getByText(RESUBMIT_EVIDENCE_HINT)).toBeInTheDocument();
  });

  it("replaces the button with a confirmation once the bounce is answered", () => {
    renderControl({ kind: "done" });
    expect(screen.queryByRole("button", { name: RESUBMIT_LABEL })).not.toBeInTheDocument();
    expect(screen.getByText(RESUBMIT_DONE_NOTE)).toBeInTheDocument();
  });

  // The press itself: without these, deleting the whole handler (and the sheet,
  // and router.refresh) leaves every render assertion above green.
  it("sends the resubmit and refreshes once confirmed", async () => {
    const user = userEvent.setup();
    renderControl({ kind: "ready" });
    await user.click(screen.getByRole("button", { name: RESUBMIT_LABEL }));
    // The sheet's confirm is the second control with the same name.
    const confirms = screen.getAllByRole("button", { name: RESUBMIT_LABEL });
    await user.click(confirms[confirms.length - 1]!);
    await waitFor(() =>
      expect(resubmit).toHaveBeenCalledWith({ projectId: PROJECT, workPackageId: WP }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  // The spec's stale-race case: the WP was decided while the sheet was open.
  it("shows the server's refusal and does not refresh", async () => {
    resubmit.mockResolvedValue({ ok: false, error: "รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ" });
    const user = userEvent.setup();
    renderControl({ kind: "ready" });
    await user.click(screen.getByRole("button", { name: RESUBMIT_LABEL }));
    const confirms = screen.getAllByRole("button", { name: RESUBMIT_LABEL });
    await user.click(confirms[confirms.length - 1]!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
