// Spec 363 U4 slice 2 — the `ของ` tab's rendered list.
//
// Additive by design: this PR adds the tab, it does NOT delete คำขอซื้อ /
// เบิกของ / ค่าใช้จ่ายหน้างาน. The three per-issue affordances those tabs carry
// (ยืนยันรับแทน · แก้รายการที่บันทึกผิด · คืนเข้าคลัง) stay where they are until
// the merge PR moves them into the row detail — deleting a tab before its
// affordances have a new home is the half-that-removes-a-signal shape.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WpThingsView } from "@/components/features/work-packages/wp-things-view";
import { groupWpThings } from "@/lib/work-packages/things";

const requests = [
  {
    id: "r1",
    prNumber: 12,
    itemDescription: "ปูนซีเมนต์",
    quantity: 10,
    unit: "ถุง",
    status: "requested" as const,
    requestedAt: "2026-07-20T03:00:00Z",
  },
  {
    id: "r2",
    prNumber: 13,
    itemDescription: "เหล็กเส้น",
    quantity: 4,
    unit: "เส้น",
    status: "delivered" as const,
    requestedAt: "2026-07-21T03:00:00Z",
  },
  {
    id: "r3",
    prNumber: 14,
    itemDescription: "สีรองพื้น",
    quantity: 2,
    unit: "กระป๋อง",
    status: "cancelled" as const,
    requestedAt: "2026-07-22T03:00:00Z",
  },
];

const issues = [
  {
    id: "i1",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    qty: 5,
    returnedQty: 0,
    issuedAt: "2026-07-23T03:00:00Z",
  },
];

function renderView(over: Partial<Parameters<typeof groupWpThings>[0]> = {}) {
  const groups = groupWpThings({
    requests: over.requests ?? requests,
    issues: over.issues ?? issues,
  });
  render(<WpThingsView groups={groups} requestHref={(id) => `/requests/${id}`} />);
}

describe("WpThingsView (spec 363 U4 slice 2)", () => {
  it("renders a heading for each non-empty group", () => {
    renderView();
    expect(screen.getByRole("heading", { name: /รออนุมัติ/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /มาถึงคลังแล้ว/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /อยู่ที่งานนี้/ })).toBeInTheDocument();
  });

  it("puts the delivered request under มาถึงคลังแล้ว, not under รออนุมัติ", () => {
    renderView();
    const atStore = screen.getByRole("heading", { name: /มาถึงคลังแล้ว/ }).closest("details")!;
    expect(within(atStore).getByText(/เหล็กเส้น/)).toBeInTheDocument();
    const awaiting = screen.getByRole("heading", { name: /รออนุมัติ/ }).closest("details")!;
    expect(within(awaiting).queryByText(/เหล็กเส้น/)).toBeNull();
  });

  it("shows the group's row count so a collapsed group still reports its size", () => {
    renderView();
    const closed = screen.getByRole("heading", { name: /ปิดแล้ว/ }).closest("details")!;
    expect(within(closed).getByText("1")).toBeInTheDocument();
  });

  it("renders the retrospective groups collapsed and the active ones open", () => {
    renderView();
    const open = (name: RegExp) =>
      screen.getByRole("heading", { name }).closest("details")?.hasAttribute("open") ?? null;
    expect(open(/อยู่ที่งานนี้/)).toBe(true);
    expect(open(/ปิดแล้ว/)).toBe(false);
  });

  it("hides a group that has no rows rather than showing an empty heading", () => {
    renderView({ requests: [], issues: [] });
    expect(screen.queryByRole("heading", { name: /รออนุมัติ/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /ปิดแล้ว/ })).toBeNull();
  });

  it("says so when the WP has nothing at all", () => {
    renderView({ requests: [], issues: [] });
    expect(screen.getByText(/ยังไม่มีของ/)).toBeInTheDocument();
  });

  it("links a request row to its detail page", () => {
    renderView();
    const link = screen.getByRole("link", { name: /ปูนซีเมนต์/ });
    expect(link).toHaveAttribute("href", "/requests/r1");
  });

  it("shows quantity and unit on both row kinds", () => {
    renderView();
    expect(screen.getByText(/10 ถุง/)).toBeInTheDocument();
    expect(screen.getByText(/5 ม้วน/)).toBeInTheDocument();
  });

  it("renders no money — PR amounts stay hidden from the site admin", () => {
    renderView();
    expect(document.body.textContent).not.toMatch(/฿/);
  });
});
