// Spec 177 U2 — the /store surface: pick a project, see its on-hand (qty + value
// + derived moving-avg cost), and record a stock-in (รับเข้า) at cost. Mocked
// action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockRecordBulk, mockCount, mockRevReceipt, mockRefresh, mockPush } = vi.hoisted(
  () => ({
    mockRecord: vi.fn(),
    mockRecordBulk: vi.fn(),
    mockCount: vi.fn(),
    mockRevReceipt: vi.fn(),
    mockRefresh: vi.fn(),
    mockPush: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("@/app/store/actions", () => ({
  recordStockIn: mockRecord,
  recordStockInBulk: mockRecordBulk,
  recordStockCount: mockCount,
  reverseStockReceipt: mockRevReceipt,
}));

import {
  StoreManager,
  type StockRow,
  type ReceiptRow,
  type CountRow,
} from "@/components/features/store/store-manager";
import { STORE_FIX_WRONG_ENTRY_LABEL } from "@/lib/i18n/labels";

const projects = [
  { id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" },
  { id: "p2", code: "PRC-2026-002", name: "อาคารบี" },
];
const catalogItems = [
  {
    id: "ci1",
    category: "electrical" as const,
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
  },
];
const suppliers = [{ id: "s1", name: "ร้านวัสดุดี" }];
const counts: CountRow[] = [
  {
    id: "cnt1",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    countedQty: 18,
    variance: -2,
  },
];
const onHand: StockRow[] = [
  {
    catalogItemId: "ci1",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    qtyOnHand: 20,
    totalValue: 600,
  },
];

const receipts: ReceiptRow[] = [
  { id: "rc1", baseItem: "ปูนซีเมนต์", specAttrs: null, unit: "ถุง", qty: 50, unitCost: 130 },
];

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue({ ok: true });
  mockRecordBulk.mockReset().mockResolvedValue({ ok: true });
  mockCount.mockReset().mockResolvedValue({ ok: true });
  mockRevReceipt.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockPush.mockReset();
});

function renderManager(opts: {
  selectedProjectId?: string | null;
  onHand?: StockRow[];
  canIssue?: boolean;
  receipts?: ReceiptRow[];
  counts?: CountRow[];
}) {
  render(
    <StoreManager
      projects={projects}
      selectedProjectId={opts.selectedProjectId === undefined ? "p1" : opts.selectedProjectId}
      onHand={opts.onHand ?? onHand}
      catalogItems={catalogItems}
      suppliers={suppliers}
      canIssue={opts.canIssue ?? false}
      receipts={opts.receipts ?? []}
      counts={opts.counts ?? []}
    />,
  );
}

describe("StoreManager (spec 177 U2)", () => {
  it("shows on-hand rows with qty, value and derived moving-avg cost", () => {
    renderManager({});
    expect(screen.getByText("สายไฟ NYY")).toBeInTheDocument();
    // qty 20 ม้วน
    expect(screen.getByText(/20\s*ม้วน/)).toBeInTheDocument();
    // moving-avg cost = 600 / 20 = 30.00
    expect(screen.getByText(/30\.00/)).toBeInTheDocument();
  });

  it("shows an empty state when the project has no stock (spec 197 U3)", () => {
    renderManager({ onHand: [] });
    expect(screen.getByText(/ยังไม่มีของในคลัง/)).toBeInTheDocument();
  });

  // Spec 213 U3: tapping a material drills into its activity log.
  it("links each on-hand row to its material log", () => {
    renderManager({});
    const link = screen.getByRole("link", { name: /สายไฟ NYY/ });
    expect(link.getAttribute("href")).toContain("/projects/p1/store/items/ci1");
  });

  it("switching the project selector navigates to that project's store", () => {
    renderManager({});
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    expect(mockPush).toHaveBeenCalledWith("/store?project=p2");
  });

  // Spec 198 U1: the รับเข้า form is a multi-row grid; one complete row enables
  // the บันทึกทั้งหมด submit.
  it("disables the record submit until item, qty and unit cost are set", () => {
    renderManager({});
    fireEvent.click(screen.getByRole("button", { name: /รับเข้าสต๊อก/ }));
    const submit = screen.getByRole("button", { name: "บันทึกทั้งหมด" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "25" } });
    expect(submit).toBeEnabled();
  });

  // Spec 198 U1: a single-row check-in records one bulk line.
  it("records a stock-in with the chosen item, qty, unit cost, supplier and note", async () => {
    renderManager({});
    fireEvent.click(screen.getByRole("button", { name: /รับเข้าสต๊อก/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText(/ผู้ขาย/), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: "งวดแรก" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกทั้งหมด" }));

    await waitFor(() =>
      expect(mockRecordBulk).toHaveBeenCalledWith({
        projectId: "p1",
        lines: [{ catalogItemId: "ci1", qty: 10, unitCost: 25, supplierId: "s1", note: "งวดแรก" }],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("the record control is hidden until a project is selected", () => {
    renderManager({ selectedProjectId: null, onHand: [] });
    expect(screen.queryByRole("button", { name: /รับเข้าสต๊อก/ })).toBeNull();
  });
});

// Spec 210: the store console is no longer the เบิก surface. Withdrawal is
// created AND managed (history / undo / confirm-on-behalf) on the WP detail
// เบิกของ tab; the console keeps only inventory (on-hand, รับเข้า, ตรวจนับ).
describe("StoreManager has no เบิก surface (spec 210)", () => {
  it("shows no เบิกล่าสุด history on the store console", () => {
    renderManager({ canIssue: true });
    expect(screen.queryByText("เบิกล่าสุด")).toBeNull();
  });

  it("shows no confirm-on-behalf control on the store console", () => {
    renderManager({ canIssue: true });
    expect(screen.queryByRole("button", { name: "ยืนยันรับแทน" })).toBeNull();
  });
});

describe("StoreManager ตรวจนับ/count (spec 177 U10)", () => {
  it("offers a ตรวจนับ control per on-hand row when the user can issue", () => {
    renderManager({ canIssue: true });
    expect(screen.getByRole("button", { name: "ตรวจนับ" })).toBeInTheDocument();
  });

  it("shows no ตรวจนับ control when the user cannot issue", () => {
    renderManager({ canIssue: false });
    expect(screen.queryByRole("button", { name: "ตรวจนับ" })).toBeNull();
  });

  it("previews the variance against the system qty", () => {
    renderManager({ canIssue: true });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจนับ" }));
    fireEvent.change(screen.getByLabelText(/จำนวนที่นับได้/), { target: { value: "18" } });
    // system 20 − counted 18 → variance -2 (ขาด)
    expect(screen.getByText(/ส่วนต่าง -2/)).toBeInTheDocument();
  });

  // Feedback 8bb3dc63: ตรวจนับ is not an entry-undo — the cost of a เบิก
  // recorded with the wrong qty does not reverse by recounting. The sheet warns
  // and points to the real tool (the issue-undo lives on the WP page, spec 210).
  it("the count sheet warns it is not how to undo a wrong เบิก, pointing to the WP", () => {
    renderManager({ canIssue: true });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจนับ" }));
    const hint = screen.getByText(/ไม่ใช่การแก้รายการเบิกที่บันทึกผิด/);
    expect(hint).toHaveTextContent("หน้างาน (WP)");
    expect(hint).toHaveTextContent(STORE_FIX_WRONG_ENTRY_LABEL);
  });

  it("records a count with the counted qty", async () => {
    renderManager({ canIssue: true });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจนับ" }));
    fireEvent.change(screen.getByLabelText(/จำนวนที่นับได้/), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการนับ" }));

    await waitFor(() =>
      expect(mockCount).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        countedQty: 18,
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});

describe("StoreManager แก้รายการที่บันทึกผิด/reversal (spec 177 U12)", () => {
  it("lists recent รับเข้า with a แก้รายการที่บันทึกผิด control (any /store user)", () => {
    renderManager({ canIssue: false, receipts });
    expect(screen.getByText("ปูนซีเมนต์")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แก้รายการที่บันทึกผิด" })).toBeInTheDocument();
  });

  it("reverses a receipt after confirm", async () => {
    renderManager({ canIssue: false, receipts });
    fireEvent.click(screen.getByRole("button", { name: "แก้รายการที่บันทึกผิด" }));
    // ConfirmActionButton opens the dialog; confirm with the ยืนยัน button.
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockRevReceipt).toHaveBeenCalledWith({ receiptId: "rc1" }));
  });
});

describe("StoreManager count history (spec 178 B3)", () => {
  it("lists recent counts with the variance", () => {
    renderManager({ counts });
    expect(screen.getByText("ประวัติการนับ")).toBeInTheDocument();
    expect(screen.getByText(/ส่วนต่าง\s*-2/)).toBeInTheDocument();
  });

  it("shows no count-history section when there are no counts", () => {
    renderManager({ counts: [] });
    expect(screen.queryByText("ประวัติการนับ")).toBeNull();
  });
});
