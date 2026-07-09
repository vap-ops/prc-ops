// Writing failing test first.
//
// Spec 284 U5 — the document-decision form on the /legal/approvals queue. A legal
// reviewer must supply a REQUIRED comment before ANY decision (approve / reject /
// needs_revision) can be submitted: submit_document_decision (U4) rejects a blank
// comment server-side, and the UI gates it too (the buttons stay disabled). On a
// decision it relays submitDocumentDecision and refreshes the queue.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitDocumentDecision } = vi.hoisted(() => ({ submitDocumentDecision: vi.fn() }));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/legal/approvals", () => ({ submitDocumentDecision }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { DocumentDecisionForm } from "@/components/features/legal/document-decision-form";

beforeEach(() => {
  submitDocumentDecision.mockReset().mockResolvedValue({ ok: true, id: "d-1" });
  refresh.mockReset();
});

describe("DocumentDecisionForm — spec 284 U5", () => {
  it("blocks every decision until a comment is entered", () => {
    render(<DocumentDecisionForm contractId="c-1" />);
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ไม่อนุมัติ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ขอแก้ไข" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "เอกสารครบถ้วน" } });
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeEnabled();
  });

  it("relays the chosen decision with the comment, then refreshes", async () => {
    render(<DocumentDecisionForm contractId="c-1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "เอกสารครบถ้วน" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    });

    expect(submitDocumentDecision).toHaveBeenCalledWith({
      contractId: "c-1",
      decision: "approve",
      comment: "เอกสารครบถ้วน",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
