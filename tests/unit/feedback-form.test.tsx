// Spec 193 — FeedbackForm: the guided bug/feature report. Type toggle swaps the
// details guidance; on submit it relays to submitFeedback and shows a thank-you.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { submitFeedback, mockRefresh, trackFriction } = vi.hoisted(() => ({
  submitFeedback: vi.fn(),
  mockRefresh: vi.fn(),
  trackFriction: vi.fn(),
}));
vi.mock("@/app/feedback/actions", () => ({ submitFeedback }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
// Spec 244 U2b-3 — the form reports form_abandon friction on leave-while-dirty via
// the friction bridge; mock the leaf so we can assert the emit (and its absence).
vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { FeedbackForm } from "@/components/features/feedback/feedback-form";

describe("FeedbackForm", () => {
  beforeEach(() => {
    submitFeedback.mockReset().mockResolvedValue({ ok: true, id: "fb1" });
    trackFriction.mockReset();
  });

  it("renders the type toggle, title, details, and submit", () => {
    render(<FeedbackForm />);
    expect(screen.getByRole("button", { name: /แจ้งปัญหา/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ขอฟีเจอร์/ })).toBeInTheDocument();
    expect(screen.getByLabelText("หัวข้อ")).toBeInTheDocument();
    expect(screen.getByLabelText("รายละเอียด")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ส่ง" })).toBeInTheDocument();
  });

  it("offers an image attach control (spec 193 U2)", () => {
    render(<FeedbackForm />);
    expect(screen.getByText("แนบรูป (ถ้ามี)")).toBeInTheDocument();
    expect(screen.getByText("เพิ่มรูป")).toBeInTheDocument();
  });

  it("swaps the details guidance when switching to a feature request", () => {
    render(<FeedbackForm />);
    const details = screen.getByLabelText("รายละเอียด");
    const bugHint = details.getAttribute("placeholder");
    fireEvent.click(screen.getByRole("button", { name: /ขอฟีเจอร์/ }));
    expect(details.getAttribute("placeholder")).not.toBe(bugHint);
  });

  it("submits the report and shows a thank-you", async () => {
    render(<FeedbackForm />);
    fireEvent.change(screen.getByLabelText("หัวข้อ"), { target: { value: "ปุ่มกดไม่ได้" } });
    fireEvent.change(screen.getByLabelText("รายละเอียด"), {
      target: { value: "กดแล้วไม่มีอะไรเกิดขึ้น" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ส่ง" }));
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "bug",
          title: "ปุ่มกดไม่ได้",
          body: "กดแล้วไม่มีอะไรเกิดขึ้น",
        }),
      ),
    );
    expect(await screen.findByText(/ขอบคุณ/)).toBeInTheDocument();
  });

  // Spec 244 U2b-3 — form_abandon friction: a report the user began but left
  // without submitting. PDPA-min: only the form id, never the typed content.
  it("reports form_abandon when a started report is left (unmount) without submitting", () => {
    const { unmount } = render(<FeedbackForm />);
    fireEvent.change(screen.getByLabelText("หัวข้อ"), { target: { value: "ปุ่มกดไม่ได้" } });
    unmount();
    expect(trackFriction).toHaveBeenCalledWith("form_abandon", { form: "feedback" });
  });

  it("does NOT report form_abandon after a successful submit", async () => {
    const { unmount } = render(<FeedbackForm />);
    fireEvent.change(screen.getByLabelText("หัวข้อ"), { target: { value: "ปุ่มกดไม่ได้" } });
    fireEvent.change(screen.getByLabelText("รายละเอียด"), {
      target: { value: "กดแล้วไม่มีอะไรเกิดขึ้น" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ส่ง" }));
    await screen.findByText(/ขอบคุณ/);
    unmount();
    expect(trackFriction).not.toHaveBeenCalledWith("form_abandon", expect.anything());
  });

  it("does NOT report form_abandon when the form was never filled", () => {
    const { unmount } = render(<FeedbackForm />);
    unmount();
    expect(trackFriction).not.toHaveBeenCalled();
  });
});
