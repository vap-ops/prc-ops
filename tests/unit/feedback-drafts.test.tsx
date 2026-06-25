// Spec 201 U4 — FeedbackDrafts: the operator's approval gate. Lists CC-staged drafts
// awaiting review; อนุมัติ publishes one to the reporter, ทิ้ง drops it. Renders
// nothing when there are no pending drafts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { publishFeedbackDraft, discardFeedbackDraft, mockRefresh } = vi.hoisted(() => ({
  publishFeedbackDraft: vi.fn(),
  discardFeedbackDraft: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/app/feedback/[id]/actions", () => ({ publishFeedbackDraft, discardFeedbackDraft }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { FeedbackDrafts, type PendingDraft } from "@/components/features/feedback/feedback-drafts";

const drafts: PendingDraft[] = [
  { id: "dr1", body: "ขอรูปหน้าจอตอนค้างด้วยครับ", createdAt: "2026-06-25T03:00:00Z" },
];

describe("FeedbackDrafts", () => {
  beforeEach(() => {
    publishFeedbackDraft.mockReset().mockResolvedValue({ ok: true });
    discardFeedbackDraft.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("renders each pending draft with approve and discard controls", () => {
    render(<FeedbackDrafts drafts={drafts} />);
    expect(screen.getByText("ขอรูปหน้าจอตอนค้างด้วยครับ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /อนุมัติ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ทิ้ง/ })).toBeInTheDocument();
  });

  it("publishes a draft on approve and refreshes", async () => {
    render(<FeedbackDrafts drafts={drafts} />);
    fireEvent.click(screen.getByRole("button", { name: /อนุมัติ/ }));
    await waitFor(() => expect(publishFeedbackDraft).toHaveBeenCalledWith("dr1"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("discards a draft on ทิ้ง", async () => {
    render(<FeedbackDrafts drafts={drafts} />);
    fireEvent.click(screen.getByRole("button", { name: /ทิ้ง/ }));
    await waitFor(() => expect(discardFeedbackDraft).toHaveBeenCalledWith("dr1"));
  });

  it("renders nothing when there are no pending drafts", () => {
    const { container } = render(<FeedbackDrafts drafts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
