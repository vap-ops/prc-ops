// Spec 177 U2 — the /store surface: pick a project, see its on-hand (qty + value
// + derived moving-avg cost), and record a stock-in (รับเข้า) at cost. Mocked
// action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockIssue, mockCount, mockRevReceipt, mockRevIssue, mockRefresh, mockPush } =
  vi.hoisted(() => ({
    mockRecord: vi.fn(),
    mockIssue: vi.fn(),
    mockCount: vi.fn(),
    mockRevReceipt: vi.fn(),
    mockRevIssue: vi.fn(),
    mockRefresh: vi.fn(),
    mockPush: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("@/app/store/actions", () => ({
  recordStockIn: mockRecord,
  issueStock: mockIssue,
  recordStockCount: mockCount,
  reverseStockReceipt: mockRevReceipt,
  reverseStockIssue: mockRevIssue,
}));

import {
  StoreManager,
  type StockRow,
  type IssueRow,
  type ReceiptRow,
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
const workPackages = [{ id: "wp1", code: "WP-01", name: "งานเดินไฟ" }];
const workers = [{ id: "w1", name: "สมชาย" }];
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
  mockIssue.mockReset().mockResolvedValue({ ok: true });
  mockCount.mockReset().mockResolvedValue({ ok: true });
  mockRevReceipt.mockReset().mockResolvedValue({ ok: true });
  mockRevIssue.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockPush.mockReset();
});

function renderManager(opts: {
  selectedProjectId?: string | null;
  onHand?: StockRow[];
  canIssue?: boolean;
  issues?: IssueRow[];
  receipts?: ReceiptRow[];
}) {
  render(
    <StoreManager
      projects={projects}
      selectedProjectId={opts.selectedProjectId === undefined ? "p1" : opts.selectedProjectId}
      onHand={opts.onHand ?? onHand}
      catalogItems={catalogItems}
      suppliers={suppliers}
      canIssue={opts.canIssue ?? false}
      workPackages={workPackages}
      workers={workers}
      issues={opts.issues ?? []}
      receipts={opts.receipts ?? []}
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

  it("shows an empty state when the project has no stock", () => {
    renderManager({ onHand: [] });
    expect(screen.getByText("ยังไม่มีสต๊อกในสโตร์")).toBeInTheDocument();
  });

  it("switching the project selector navigates to that project's store", () => {
    renderManager({});
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    expect(mockPush).toHaveBeenCalledWith("/store?project=p2");
  });

  it("disables the record submit until item, qty and unit cost are set", () => {
    renderManager({});
    fireEvent.click(screen.getByRole("button", { name: /รับเข้าสต๊อก/ }));
    const submit = screen.getByRole("button", { name: "บันทึก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "25" } });
    expect(submit).toBeEnabled();
  });

  it("records a stock-in with the chosen item, qty, unit cost, supplier and note", async () => {
    renderManager({});
    fireEvent.click(screen.getByRole("button", { name: /รับเข้าสต๊อก/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText(/ผู้ขาย/), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: "งวดแรก" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockRecord).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        qty: 10,
        unitCost: 25,
        supplierId: "s1",
        note: "งวดแรก",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("the record control is hidden until a project is selected", () => {
    renderManager({ selectedProjectId: null, onHand: [] });
    expect(screen.queryByRole("button", { name: /รับเข้าสต๊อก/ })).toBeNull();
  });
});

describe("StoreManager เบิก/issue (spec 177 U4)", () => {
  it("shows no เบิก control on on-hand rows when the user cannot issue", () => {
    renderManager({ canIssue: false });
    expect(screen.queryByRole("button", { name: "เบิก" })).toBeNull();
  });

  it("offers a เบิก control per on-hand row when the user can issue", () => {
    renderManager({ canIssue: true });
    expect(screen.getByRole("button", { name: "เบิก" })).toBeInTheDocument();
  });

  it("issues the row's item to the chosen WP and qty", async () => {
    renderManager({ canIssue: true });
    fireEvent.click(screen.getByRole("button", { name: "เบิก" }));
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssue).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        workPackageId: "wp1",
        qty: 5,
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("names a receiver worker on a /store เบิก (custody handshake)", async () => {
    renderManager({ canIssue: true });
    fireEvent.click(screen.getByRole("button", { name: "เบิก" }));
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/ผู้รับ/), { target: { value: "w1" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssue).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        workPackageId: "wp1",
        qty: 5,
        note: "",
        receiverWorkerId: "w1",
      }),
    );
  });

  it("disables the เบิก submit until a WP and qty are set", () => {
    renderManager({ canIssue: true });
    fireEvent.click(screen.getByRole("button", { name: "เบิก" }));
    const submit = screen.getByRole("button", { name: "ยืนยันการเบิก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    expect(submit).toBeEnabled();
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

describe("StoreManager กลับรายการ/reversal (spec 177 U12)", () => {
  it("lists recent รับเข้า with a กลับรายการ control (any /store user)", () => {
    renderManager({ canIssue: false, receipts });
    expect(screen.getByText("ปูนซีเมนต์")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "กลับรายการ" })).toBeInTheDocument();
  });

  it("reverses a receipt after confirm", async () => {
    renderManager({ canIssue: false, receipts });
    fireEvent.click(screen.getByRole("button", { name: "กลับรายการ" }));
    // ConfirmActionButton opens the dialog; confirm with the ยืนยัน button.
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockRevReceipt).toHaveBeenCalledWith({ receiptId: "rc1" }));
  });

  it("offers กลับรายการ on an issue only when the user can issue", () => {
    renderManager({ canIssue: true, issues });
    expect(screen.getByRole("button", { name: "กลับรายการ" })).toBeInTheDocument();
  });

  it("hides issue กลับรายการ when the user cannot issue", () => {
    renderManager({ canIssue: false, issues });
    expect(screen.queryByRole("button", { name: "กลับรายการ" })).toBeNull();
  });

  it("reverses an issue after confirm", async () => {
    renderManager({ canIssue: true, issues });
    fireEvent.click(screen.getByRole("button", { name: "กลับรายการ" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockRevIssue).toHaveBeenCalledWith({ issueId: "iss1" }));
  });
});
