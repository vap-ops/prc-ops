// Spec 177 U5 — เบิก at the WP detail (site_admin field-draw). A site staffer
// draws stock from the project store TO this work package. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIssue, mockRev, mockRefresh } = vi.hoisted(() => ({
  mockIssue: vi.fn(),
  mockRev: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/store/actions", () => ({ issueStock: mockIssue, reverseStockIssue: mockRev }));

import {
  WpIssueStock,
  type WpStockRow,
  type WpIssueRow,
} from "@/components/features/store/wp-issue-stock";

const onHand: WpStockRow[] = [
  { catalogItemId: "ci1", baseItem: "สายไฟ NYY", specAttrs: "3x6", unit: "ม้วน", qtyOnHand: 20 },
];
const workers = [{ id: "w1", name: "สมชาย" }];
const issues: WpIssueRow[] = [
  {
    id: "i1",
    baseItem: "ท่อ PVC",
    specAttrs: null,
    unit: "เส้น",
    qty: 5,
    unitCost: 40,
    receiverName: null,
    receivedAt: null,
  },
];

beforeEach(() => {
  mockIssue.mockReset().mockResolvedValue({ ok: true });
  mockRev.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderZone(opts: { onHand?: WpStockRow[]; issues?: WpIssueRow[] }) {
  render(
    <WpIssueStock
      projectId="p1"
      workPackageId="wp1"
      onHand={opts.onHand ?? onHand}
      workers={workers}
      issues={opts.issues ?? []}
    />,
  );
}

describe("WpIssueStock (spec 177 U5)", () => {
  it("offers a เบิก control when the store has stock", () => {
    renderZone({});
    expect(screen.getByRole("button", { name: /เบิกวัสดุจากสโตร์/ })).toBeInTheDocument();
  });

  it("shows an empty state and no เบิก control when the store is empty", () => {
    renderZone({ onHand: [] });
    expect(screen.getByText("ยังไม่มีสต๊อกในสโตร์")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เบิกวัสดุจากสโตร์/ })).toBeNull();
  });

  it("issues the chosen item to this work package", async () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากสโตร์/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: "หน้างาน" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssue).toHaveBeenCalledWith({
        projectId: "p1",
        catalogItemId: "ci1",
        workPackageId: "wp1",
        qty: 5,
        note: "หน้างาน",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("disables the submit until an item and qty are set", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากสโตร์/ }));
    const submit = screen.getByRole("button", { name: "ยืนยันการเบิก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    expect(submit).toBeEnabled();
  });

  it("lists this WP's recent เบิก", () => {
    renderZone({ issues });
    expect(screen.getByText("ท่อ PVC")).toBeInTheDocument();
  });

  it("names a receiver worker on the issue (custody handshake)", async () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากสโตร์/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
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

  it("shows a pending-receipt badge for a named-but-unconfirmed issue", () => {
    renderZone({
      issues: [{ ...issues[0]!, receiverName: "สมชาย", receivedAt: null }],
    });
    expect(screen.getByText(/รอรับ/)).toBeInTheDocument();
    expect(screen.getByText(/สมชาย/)).toBeInTheDocument();
  });

  it("shows a received badge once the receiver has confirmed", () => {
    renderZone({
      issues: [{ ...issues[0]!, receiverName: "สมชาย", receivedAt: "2026-06-22T10:00:00Z" }],
    });
    expect(screen.getByText(/รับแล้ว/)).toBeInTheDocument();
  });

  // Spec 178 Stream B — a กลับรายการ control on each recent เบิก, mirroring /store
  // U12. The render gate is SITE_STAFF (the WP-detail !readOnly), the same gate as
  // reverse_stock_issue, so every issue here is reversible by the field staffer.
  it("offers a กลับรายการ control on each recent เบิก", () => {
    renderZone({ issues });
    expect(screen.getByRole("button", { name: "กลับรายการ" })).toBeInTheDocument();
  });

  it("reverses the issue after confirm", async () => {
    renderZone({ issues });
    fireEvent.click(screen.getByRole("button", { name: "กลับรายการ" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockRev).toHaveBeenCalledWith({ issueId: "i1" }));
  });
});
