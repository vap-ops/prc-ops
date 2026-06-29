// Spec 201 (review kanban) — the operator triage board. groupFeedbackByStatus is
// the pure column model; FeedbackKanban renders the four lifecycle columns with each
// report as a card whose status control moves it between columns.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// FeedbackStatusControl (rendered on every card) imports the action + router + toast.
vi.mock("@/app/feedback/review/actions", () => ({ setFeedbackStatus: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { groupFeedbackByStatus, FEEDBACK_STATUS_ORDER } from "@/lib/feedback/kanban";
import {
  FeedbackKanban,
  type FeedbackCardVM,
} from "@/components/features/feedback/feedback-kanban";
import { FEEDBACK_STATUS_LABEL } from "@/lib/i18n/labels";

describe("groupFeedbackByStatus", () => {
  it("returns the four columns in lifecycle order", () => {
    expect(groupFeedbackByStatus([]).map((c) => c.status)).toEqual([
      "open",
      "in_progress",
      "done",
      "declined",
    ]);
    expect(FEEDBACK_STATUS_ORDER).toEqual(["open", "in_progress", "done", "declined"]);
  });

  it("places each card in its status column and keeps empty columns", () => {
    const cards = [{ status: "open" }, { status: "done" }, { status: "open" }] as const;
    const cols = groupFeedbackByStatus(cards);
    const count = Object.fromEntries(cols.map((c) => [c.status, c.items.length]));
    expect(count).toEqual({ open: 2, in_progress: 0, done: 1, declined: 0 });
  });

  it("preserves input order within a column", () => {
    const cards = [
      { status: "open", id: "a" },
      { status: "open", id: "b" },
    ] as const;
    const open = groupFeedbackByStatus(cards).find((c) => c.status === "open")!;
    expect(open.items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

const card = (over: Partial<FeedbackCardVM>): FeedbackCardVM => ({
  id: "f1",
  feedbackNumber: 1,
  type: "bug",
  status: "open",
  title: "หัวข้อ",
  body: "เนื้อหา",
  createdAt: "2026-06-25T00:00:00Z",
  roleSnapshot: "site_admin",
  appVersion: "0.1.0",
  userAgent: null,
  screen: null,
  pagePath: null,
  attachmentUrls: [],
  ...over,
});

describe("FeedbackKanban", () => {
  it("renders a heading per lifecycle column", () => {
    render(<FeedbackKanban cards={[]} />);
    for (const s of FEEDBACK_STATUS_ORDER) {
      expect(
        screen.getByRole("heading", { name: new RegExp(FEEDBACK_STATUS_LABEL[s]) }),
      ).toBeInTheDocument();
    }
  });

  it("renders each report as a card under its status column", () => {
    render(
      <FeedbackKanban
        cards={[
          card({ id: "a", status: "open", title: "เรื่องใหม่" }),
          card({ id: "b", status: "done", title: "เรื่องเสร็จ" }),
        ]}
      />,
    );
    expect(screen.getByText("เรื่องใหม่")).toBeInTheDocument();
    expect(screen.getByText("เรื่องเสร็จ")).toBeInTheDocument();
  });

  it("renders each report's human FB code", () => {
    render(<FeedbackKanban cards={[card({ id: "a", feedbackNumber: 7 })]} />);
    expect(screen.getByText("FB-0007")).toBeInTheDocument();
  });
});
