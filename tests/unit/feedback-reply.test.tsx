// Spec 201 U2 — FeedbackReply: the operator's reply composer on a feedback thread.
// A textarea + send; on send it relays to postFeedbackMessage(feedbackId, body),
// clears, and refreshes. A blank body does not call the action.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { postFeedbackMessage, mockRefresh } = vi.hoisted(() => ({
  postFeedbackMessage: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/app/feedback/[id]/actions", () => ({ postFeedbackMessage }));
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

import { FeedbackReply } from "@/components/features/feedback/feedback-reply";

describe("FeedbackReply", () => {
  beforeEach(() => {
    postFeedbackMessage.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("relays the typed reply for this feedback id and refreshes", async () => {
    render(<FeedbackReply feedbackId="fb1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ขอรูปด้วยครับ" } });
    fireEvent.click(screen.getByRole("button", { name: /ส่ง/ }));
    await waitFor(() => expect(postFeedbackMessage).toHaveBeenCalledWith("fb1", "ขอรูปด้วยครับ"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("does not relay a blank reply", () => {
    render(<FeedbackReply feedbackId="fb1" />);
    fireEvent.click(screen.getByRole("button", { name: /ส่ง/ }));
    expect(postFeedbackMessage).not.toHaveBeenCalled();
  });
});
