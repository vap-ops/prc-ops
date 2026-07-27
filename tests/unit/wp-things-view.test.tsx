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
  it("renders a labelled group for each non-empty group", () => {
    renderView();
    expect(screen.getByRole("group", { name: /รออนุมัติ/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /ขอซื้อที่ได้รับแล้ว/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /อยู่ที่งานนี้/ })).toBeInTheDocument();
  });

  it("puts the delivered request under the fulfilment history, not under รออนุมัติ", () => {
    renderView();
    const atStore = screen.getByRole("group", { name: /ขอซื้อที่ได้รับแล้ว/ });
    expect(within(atStore).getByText(/เหล็กเส้น/)).toBeInTheDocument();
    const awaiting = screen.getByRole("group", { name: /รออนุมัติ/ });
    expect(within(awaiting).queryByText(/เหล็กเส้น/)).toBeNull();
  });

  it("shows the group's row count so a collapsed group still reports its size", () => {
    renderView();
    const closed = screen.getByRole("group", { name: /ปิดแล้ว/ });
    expect(within(closed).getByText("1")).toBeInTheDocument();
  });

  it("renders the retrospective groups collapsed and the active ones open", () => {
    renderView();
    const open = (name: RegExp) =>
      screen.getByRole("group", { name })?.hasAttribute("open") ?? null;
    expect(open(/อยู่ที่งานนี้/)).toBe(true);
    expect(open(/ปิดแล้ว/)).toBe(false);
  });

  it("hides a group that has no rows rather than showing an empty heading", () => {
    // Default fixture has NO returned rows — so this exercises the present-filter
    // rather than the empty-state early return (which the next test covers).
    renderView();
    expect(screen.getByRole("group", { name: /รออนุมัติ/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /คืนแล้ว/ })).toBeNull();
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

  it("reports the REMAINDER here and the RETURNED amount under คืนแล้ว", () => {
    // 5 issued, 3 returned: 2 are on site and 3 came back. Printing the issued
    // qty in both groups makes both numbers wrong in the one tab whose job is
    // "how much is where".
    renderView({
      requests: [],
      issues: [
        {
          id: "i-part",
          baseItem: "ท่อ",
          specAttrs: null,
          unit: "เส้น",
          qty: 5,
          returnedQty: 3,
          issuedAt: "2026-07-23T03:00:00Z",
        },
      ],
    });
    const here = screen.getByRole("group", { name: /อยู่ที่งานนี้/ });
    expect(within(here).getByText("2 เส้น")).toBeInTheDocument();
    const returned = screen.getByRole("group", { name: /คืนแล้ว/ });
    expect(within(returned).getByText("3 เส้น")).toBeInTheDocument();
  });
});
