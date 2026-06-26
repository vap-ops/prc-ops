// Spec 177 U2 — the /store surface: pick a project, see its on-hand (qty + value
// + derived moving-avg cost), and record a stock-in (รับเข้า) at cost. Mocked
// action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRecord,
  mockRecordBulk,
  mockCount,
  mockRevReceipt,
  mockRevIssue,
  mockConfirmOB,
  mockRefresh,
  mockPush,
} = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockRecordBulk: vi.fn(),
  mockCount: vi.fn(),
  mockRevReceipt: vi.fn(),
  mockRevIssue: vi.fn(),
  mockConfirmOB: vi.fn(),
  mockRefresh: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("@/app/store/actions", () => ({
  recordStockIn: mockRecord,
  recordStockInBulk: mockRecordBulk,
  recordStockCount: mockCount,
  reverseStockReceipt: mockRevReceipt,
  reverseStockIssue: mockRevIssue,
  confirmStockIssueOnBehalf: mockConfirmOB,
}));

import {
  StoreManager,
  type StockRow,
  type IssueRow,
  type ReceiptRow,
  type CountRow,
} from "@/components/features/store/store-manager";

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
const issues: IssueRow[] = [
  {
    id: "iss1",
    baseItem: "ท่อ PVC",
    specAttrs: null,
    unit: "เส้น",
    qty: 8,
    unitCost: 45,
    wpLabel: "WP-01 งานเดินไฟ",
    receiverWorkerId: "w1",
    receivedAt: null,
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
  mockRevIssue.mockReset().mockResolvedValue({ ok: true });
  mockConfirmOB.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockPush.mockReset();
});

function renderManager(opts: {
  selectedProjectId?: string | null;
  onHand?: StockRow[];
  canIssue?: boolean;
  issues?: IssueRow[];
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
      issues={opts.issues ?? []}
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

// Spec 208: withdrawal is INITIATED on the WP detail page (เบิกของ tab), not the
// store console. The store console keeps the read-only เบิกล่าสุด history (+ the
// confirm-on-behalf / reverse management below); it no longer offers a เบิก button.
describe("StoreManager เบิกล่าสุด history (spec 177 U4 / spec 208)", () => {
  it("shows no เบิก initiation control on the store console", () => {
    renderManager({ canIssue: true });
    expect(screen.queryByRole("button", { name: "เบิก" })).toBeNull();
  });

  it("lists recent เบิก for the project", () => {
    renderManager({ canIssue: true, issues });
    expect(screen.getByText("ท่อ PVC")).toBeInTheDocument();
    expect(screen.getByText(/WP-01/)).toBeInTheDocument();
  });

  it("badges a named issue as pending vs received", () => {
    renderManager({ canIssue: true, issues });
    expect(screen.getByText(/รอรับ/)).toBeInTheDocument();
    renderManager({
      canIssue: true,
      issues: [{ ...issues[0]!, receivedAt: "2026-06-22T10:00:00Z" }],
    });
    expect(screen.getByText(/รับแล้ว/)).toBeInTheDocument();
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

  it("offers แก้รายการที่บันทึกผิด on an issue only when the user can issue", () => {
    renderManager({ canIssue: true, issues });
    expect(screen.getByRole("button", { name: "แก้รายการที่บันทึกผิด" })).toBeInTheDocument();
  });

  it("hides issue แก้รายการที่บันทึกผิด when the user cannot issue", () => {
    renderManager({ canIssue: false, issues });
    expect(screen.queryByRole("button", { name: "แก้รายการที่บันทึกผิด" })).toBeNull();
  });

  it("reverses an issue after confirm", async () => {
    renderManager({ canIssue: true, issues });
    fireEvent.click(screen.getByRole("button", { name: "แก้รายการที่บันทึกผิด" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockRevIssue).toHaveBeenCalledWith({ issueId: "iss1" }));
  });
});

describe("StoreManager confirm-on-behalf (spec 178 B5)", () => {
  it("offers ยืนยันรับแทน on a pending named issue for a manager", () => {
    renderManager({ canIssue: true, issues });
    expect(screen.getByRole("button", { name: "ยืนยันรับแทน" })).toBeInTheDocument();
  });

  it("hides ยืนยันรับแทน once the issue is received", () => {
    renderManager({
      canIssue: true,
      issues: [{ ...issues[0]!, receivedAt: "2026-06-22T10:00:00Z" }],
    });
    expect(screen.queryByRole("button", { name: "ยืนยันรับแทน" })).toBeNull();
  });

  it("hides ยืนยันรับแทน for a non-manager", () => {
    renderManager({ canIssue: false, issues });
    expect(screen.queryByRole("button", { name: "ยืนยันรับแทน" })).toBeNull();
  });

  it("confirms on behalf after confirm", async () => {
    renderManager({ canIssue: true, issues });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันรับแทน" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockConfirmOB).toHaveBeenCalledWith({ issueId: "iss1" }));
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
