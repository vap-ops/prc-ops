// Spec 193 U3 — FeedbackStatusControl: the super_admin triage control on the
// feedback review list. Renders the four lifecycle statuses; the current one is
// pressed; tapping another relays to setFeedbackStatus(id, status) and refreshes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { setFeedbackStatus, mockRefresh } = vi.hoisted(() => ({
  setFeedbackStatus: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/app/feedback/review/actions", () => ({ setFeedbackStatus }));
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

import { FeedbackStatusControl } from "@/components/features/feedback/feedback-status-control";
import { FEEDBACK_STATUS_LABEL } from "@/lib/i18n/labels";

describe("FeedbackStatusControl", () => {
  beforeEach(() => {
    setFeedbackStatus.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("renders all four lifecycle statuses with the current one pressed", () => {
    render(<FeedbackStatusControl id="fb1" status="open" />);
    for (const label of Object.values(FEEDBACK_STATUS_LABEL)) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: FEEDBACK_STATUS_LABEL.open })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: FEEDBACK_STATUS_LABEL.done })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("relays a status change for this feedback id and refreshes", async () => {
    render(<FeedbackStatusControl id="fb1" status="open" />);
    fireEvent.click(screen.getByRole("button", { name: FEEDBACK_STATUS_LABEL.done }));
    await waitFor(() => expect(setFeedbackStatus).toHaveBeenCalledWith("fb1", "done"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("does not relay when tapping the already-current status", () => {
    render(<FeedbackStatusControl id="fb1" status="open" />);
    fireEvent.click(screen.getByRole("button", { name: FEEDBACK_STATUS_LABEL.open }));
    expect(setFeedbackStatus).not.toHaveBeenCalled();
  });
});
