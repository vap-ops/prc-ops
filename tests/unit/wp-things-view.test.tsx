// Spec 363 U4 — the `ของ` tab's rendered list.
//
// The merge PR DELETED คำขอซื้อ / เบิกของ / ค่าใช้จ่ายหน้างาน, so this is now the
// WP's only item surface. The three per-issue affordances those tabs carried
// (ยืนยันรับแทน · แก้รายการที่บันทึกผิด · คืนเข้าคลัง) had to land in the row
// detail FIRST — deleting a tab before its affordances have a new home is the
// half-that-removes-a-signal shape. The second describe block below is that
// re-homing.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Spec 363 U4 merge — the row detail now carries the three write controls the
// เบิกของ tab used to own, so the view reaches the store server actions.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/store/actions", () => ({
  reverseStockIssue: vi.fn(),
  returnStockToStore: vi.fn(),
  confirmStockIssueOnBehalf: vi.fn(),
}));

import { WpThingsView } from "@/components/features/work-packages/wp-things-view";
import { groupWpThings } from "@/lib/work-packages/things";
import { STORE_FIX_WRONG_ENTRY_LABEL, STORE_RETURN_TO_STORE_LABEL } from "@/lib/i18n/labels";

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
    receiverName: null,
    receivedAt: null,
    unitCost: 120,
  },
];

function renderView(
  over: Partial<Parameters<typeof groupWpThings>[0]> = {},
  { canAct = true }: { canAct?: boolean } = {},
) {
  const groups = groupWpThings({
    requests: over.requests ?? requests,
    issues: over.issues ?? issues,
  });
  render(<WpThingsView groups={groups} requestHref={(id) => `/requests/${id}`} canAct={canAct} />);
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
          receiverName: null,
          receivedAt: null,
          unitCost: 40,
        },
      ],
    });
    const here = screen.getByRole("group", { name: /อยู่ที่งานนี้/ });
    expect(within(here).getByText("2 เส้น")).toBeInTheDocument();
    const returned = screen.getByRole("group", { name: /คืนแล้ว/ });
    expect(within(returned).getByText("3 เส้น")).toBeInTheDocument();
  });
});

// Spec 363 U4 merge — เบิกของ is deleted, so everything it carried per issued
// line has to arrive here: the receipt state, the issue cost, and the three write
// controls.
describe("WpThingsView — the issue row detail (the re-homed เบิกของ affordances)", () => {
  const withReceiver = [
    {
      id: "i-recv",
      baseItem: "ท่อ PVC",
      specAttrs: null,
      unit: "เส้น",
      qty: 6,
      returnedQty: 0,
      issuedAt: "2026-07-23T03:00:00Z",
      receiverName: "สมชาย",
      receivedAt: null,
      unitCost: 55,
    },
  ];

  it("offers แก้รายการที่บันทึกผิด on the issue that is still here", () => {
    renderView();
    const here = screen.getByRole("group", { name: /อยู่ที่งานนี้/ });
    expect(
      within(here).getByRole("button", { name: STORE_FIX_WRONG_ENTRY_LABEL }),
    ).toBeInTheDocument();
  });

  it("offers คืนเข้าคลัง while something remains to return", () => {
    renderView();
    const here = screen.getByRole("group", { name: /อยู่ที่งานนี้/ });
    expect(
      within(here).getByRole("button", { name: STORE_RETURN_TO_STORE_LABEL }),
    ).toBeInTheDocument();
  });

  it("offers ยืนยันรับแทน only while a named receiver is still รอรับ", () => {
    renderView({ requests: [], issues: withReceiver });
    expect(screen.getByRole("button", { name: "ยืนยันรับแทน" })).toBeInTheDocument();
    expect(screen.getByText(/รอรับ/)).toBeInTheDocument();
    expect(screen.getByText(/สมชาย/)).toBeInTheDocument();
  });

  it("drops ยืนยันรับแทน once the receiver has confirmed", () => {
    renderView({
      requests: [],
      issues: [{ ...withReceiver[0]!, receivedAt: "2026-07-24T03:00:00Z" }],
    });
    expect(screen.queryByRole("button", { name: "ยืนยันรับแทน" })).toBeNull();
    expect(screen.getByText(/รับแล้ว/)).toBeInTheDocument();
  });

  it("keeps the issue cost the เบิกของ list showed", () => {
    renderView({ requests: [], issues: withReceiver });
    expect(screen.getByText(/ต้นทุน/)).toBeInTheDocument();
    expect(screen.getByText(/55/)).toBeInTheDocument();
  });

  it("still lets a FULLY returned issue be corrected", () => {
    // It renders only under คืนแล้ว, so without the returned-group arm its
    // แก้รายการที่บันทึกผิด would have no home at all after the deletion.
    renderView({
      requests: [],
      issues: [{ ...withReceiver[0]!, qty: 6, returnedQty: 6 }],
    });
    const returned = screen.getByRole("group", { name: /คืนแล้ว/ });
    expect(
      within(returned).getByRole("button", { name: STORE_FIX_WRONG_ENTRY_LABEL }),
    ).toBeInTheDocument();
  });

  it("does not repeat the controls on both readings of a partly-returned issue", () => {
    renderView({
      requests: [],
      issues: [{ ...withReceiver[0]!, qty: 6, returnedQty: 2 }],
    });
    expect(screen.getAllByRole("button", { name: STORE_FIX_WRONG_ENTRY_LABEL })).toHaveLength(1);
  });

  it("names each request's own status, which its group cannot", () => {
    // คำขอซื้อ is deleted with its PurchaseRequestCard, so the row is now the only
    // place the status shows. รออนุมัติ covers requested/approved/purchased/
    // on_route — four different answers to "where is my cement" collapsed into
    // one heading. The card is gone; the distinction must not go with it.
    renderView();
    const awaiting = screen.getByRole("group", { name: /รออนุมัติ/ });
    expect(within(awaiting).getByText("ส่งคำขอแล้ว")).toBeInTheDocument();
  });

  it("renders NO write control for the read-only viewer", () => {
    // plain `procurement` reads this page; its only write is the purchase
    // request, which the ต้องการของ sheet owns.
    renderView({}, { canAct: false });
    expect(screen.queryByRole("button", { name: STORE_FIX_WRONG_ENTRY_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: STORE_RETURN_TO_STORE_LABEL })).toBeNull();
  });
});
