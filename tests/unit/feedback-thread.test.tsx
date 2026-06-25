// Spec 201 U2 — FeedbackThread renders a report's conversation chronologically,
// each message labelled by its author kind. Read-only presentational component.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FeedbackThread, type ThreadMessage } from "@/components/features/feedback/feedback-thread";
import { FEEDBACK_AUTHOR_LABEL } from "@/lib/i18n/labels";

const messages: ThreadMessage[] = [
  // deliberately out of order — the thread must render oldest-first
  {
    id: "m2",
    authorKind: "reporter",
    body: "ส่งรูปให้แล้วครับ",
    createdAt: "2026-06-25T05:00:00Z",
  },
  {
    id: "m1",
    authorKind: "operator",
    body: "ขอรูปหน้าจอตอนค้างด้วยครับ",
    createdAt: "2026-06-25T03:00:00Z",
  },
];

describe("FeedbackThread (spec 201)", () => {
  it("renders each message body", () => {
    render(<FeedbackThread messages={messages} />);
    expect(screen.getByText("ขอรูปหน้าจอตอนค้างด้วยครับ")).toBeInTheDocument();
    expect(screen.getByText("ส่งรูปให้แล้วครับ")).toBeInTheDocument();
  });

  it("labels each message by author kind", () => {
    render(<FeedbackThread messages={messages} />);
    expect(screen.getByText(FEEDBACK_AUTHOR_LABEL.operator)).toBeInTheDocument();
    expect(screen.getByText(FEEDBACK_AUTHOR_LABEL.reporter)).toBeInTheDocument();
  });

  it("renders oldest-first regardless of input order", () => {
    const { container } = render(<FeedbackThread messages={messages} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("ขอรูปหน้าจอตอนค้างด้วยครับ")).toBeLessThan(
      text.indexOf("ส่งรูปให้แล้วครับ"),
    );
  });

  it("shows an empty state when there are no messages", () => {
    render(<FeedbackThread messages={[]} />);
    expect(screen.getByText(/ยังไม่มีการตอบกลับ/)).toBeInTheDocument();
  });
});
