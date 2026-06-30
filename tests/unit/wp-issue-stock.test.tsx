// Spec 177 U5 — เบิก at the WP detail (site_admin field-draw). A site staffer
// draws stock from the project store TO this work package. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIssueBulk, mockRev, mockReturn, mockConfirmOB, mockRefresh } = vi.hoisted(() => ({
  mockIssueBulk: vi.fn(),
  mockRev: vi.fn(),
  mockReturn: vi.fn(),
  mockConfirmOB: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/store/actions", () => ({
  issueStockBulk: mockIssueBulk,
  reverseStockIssue: mockRev,
  returnStockToStore: mockReturn,
  confirmStockIssueOnBehalf: mockConfirmOB,
}));

import {
  WpIssueStock,
  type WpStockRow,
  type WpIssueRow,
} from "@/components/features/store/wp-issue-stock";
import type { ScopedMaterialCategory } from "@/lib/catalog/scoped-categories";

const onHand: WpStockRow[] = [
  {
    catalogItemId: "ci1",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    qtyOnHand: 20,
    categoryId: null,
    kind: null,
  },
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
    returnedQty: 0,
  },
];

beforeEach(() => {
  mockIssueBulk.mockReset().mockResolvedValue({ ok: true });
  mockRev.mockReset().mockResolvedValue({ ok: true });
  mockReturn.mockReset().mockResolvedValue({ ok: true });
  mockConfirmOB.mockReset().mockResolvedValue({ ok: true });
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
    expect(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ })).toBeInTheDocument();
  });

  it("shows an empty state and no เบิก control when the store is empty", () => {
    renderZone({ onHand: [] });
    expect(screen.getByText("ยังไม่มีสต๊อกในคลัง")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เบิกวัสดุจากคลัง/ })).toBeNull();
  });

  it("issues the chosen item to this work package", async () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: "หน้างาน" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssueBulk).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        lines: [{ catalogItemId: "ci1", qty: 5, note: "หน้างาน" }],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  // Spec 208 U3 — multi-line: withdraw several items to this WP in one atomic call.
  it("issues several rows to this WP in one bulk call", async () => {
    renderZone({
      onHand: [
        {
          catalogItemId: "ci1",
          baseItem: "สายไฟ",
          specAttrs: null,
          unit: "ม้วน",
          qtyOnHand: 20,
          categoryId: null,
          kind: null,
        },
        {
          catalogItemId: "ci2",
          baseItem: "ท่อ",
          specAttrs: null,
          unit: "เส้น",
          qtyOnHand: 50,
          categoryId: null,
          kind: null,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    // row 1
    fireEvent.change(screen.getAllByLabelText("วัสดุ")[0]!, { target: { value: "ci1" } });
    fireEvent.change(screen.getAllByLabelText("จำนวน")[0]!, { target: { value: "5" } });
    // add row 2
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายการ/ }));
    fireEvent.change(screen.getAllByLabelText("วัสดุ")[1]!, { target: { value: "ci2" } });
    fireEvent.change(screen.getAllByLabelText("จำนวน")[1]!, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssueBulk).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        lines: [
          { catalogItemId: "ci1", qty: 5, note: "" },
          { catalogItemId: "ci2", qty: 8, note: "" },
        ],
      }),
    );
  });

  it("disables the submit until an item and qty are set", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    const submit = screen.getByRole("button", { name: "ยืนยันการเบิก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    expect(submit).toBeEnabled();
  });

  // Spec 208 U2 — the client-side qty ceiling the sheet was missing: you cannot
  // เบิก more than is on hand (the server also 22023s, but block it before submit).
  it("blocks the submit when the qty exceeds what is on hand", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "25" } });
    expect(screen.getByRole("button", { name: "ยืนยันการเบิก" })).toBeDisabled();
  });

  it("warns when the qty exceeds what is on hand", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "25" } });
    expect(screen.getByText(/เกินจำนวนในคลัง/)).toBeInTheDocument();
  });

  it("allows the submit at exactly the on-hand qty", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "20" } });
    expect(screen.getByRole("button", { name: "ยืนยันการเบิก" })).toBeEnabled();
  });

  it("lists this WP's recent เบิก", () => {
    renderZone({ issues });
    expect(screen.getByText("ท่อ PVC")).toBeInTheDocument();
  });

  it("names a receiver worker on the issue (custody handshake)", async () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/ผู้รับ/), { target: { value: "w1" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssueBulk).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        lines: [{ catalogItemId: "ci1", qty: 5, note: "", receiverWorkerId: "w1" }],
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

  // Spec 178 Stream B — a แก้รายการที่บันทึกผิด control on each recent เบิก, mirroring /store
  // U12. The render gate is SITE_STAFF (the WP-detail !readOnly), the same gate as
  // reverse_stock_issue, so every issue here is reversible by the field staffer.
  it("offers a แก้รายการที่บันทึกผิด control on each recent เบิก", () => {
    renderZone({ issues });
    expect(screen.getByRole("button", { name: "แก้รายการที่บันทึกผิด" })).toBeInTheDocument();
  });

  it("reverses the issue after confirm", async () => {
    renderZone({ issues });
    fireEvent.click(screen.getByRole("button", { name: "แก้รายการที่บันทึกผิด" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockRev).toHaveBeenCalledWith({ issueId: "i1" }));
  });

  // Spec 209 U2 — the real WP→store return (partial), distinct from the mistake-undo.
  it("offers a คืนเข้าคลัง control on an issued line with qty left to return", () => {
    renderZone({ issues });
    expect(screen.getByRole("button", { name: "คืนเข้าคลัง" })).toBeInTheDocument();
  });

  it("returns a partial qty after confirm (defaults to the remaining, accepts less)", async () => {
    renderZone({ issues }); // issue i1: qty 5, returnedQty 0 → remaining 5
    fireEvent.click(screen.getByRole("button", { name: "คืนเข้าคลัง" }));
    const input = screen.getByLabelText(/จำนวนที่คืน/);
    expect((input as HTMLInputElement).value).toBe("5"); // default = remaining
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันคืน" }));
    await waitFor(() => expect(mockReturn).toHaveBeenCalledWith({ issueId: "i1", qty: 2 }));
  });

  it("hides the return control once the issue is fully returned", () => {
    renderZone({ issues: [{ ...issues[0]!, qty: 5, returnedQty: 5 }] });
    expect(screen.queryByRole("button", { name: "คืนเข้าคลัง" })).toBeNull();
  });
});

// Spec 210 — confirm-on-behalf moves here from the store console: when a เบิก
// names a receiver who hasn't confirmed yet, the site staffer can attest receipt
// on their behalf right where the issue was made (the WP). The RPC blocks the
// issuer (separation of duties); the UI shows the control whenever a named
// receiver is still รอรับ and maps the error if the issuer taps it.
describe("WpIssueStock confirm-on-behalf (spec 210)", () => {
  const pending: WpIssueRow[] = [{ ...issues[0]!, receiverName: "สมชาย", receivedAt: null }];

  it("offers ยืนยันรับแทน on a pending named issue", () => {
    renderZone({ issues: pending });
    expect(screen.getByRole("button", { name: "ยืนยันรับแทน" })).toBeInTheDocument();
  });

  it("hides ยืนยันรับแทน once the issue is received", () => {
    renderZone({
      issues: [{ ...issues[0]!, receiverName: "สมชาย", receivedAt: "2026-06-22T10:00:00Z" }],
    });
    expect(screen.queryByRole("button", { name: "ยืนยันรับแทน" })).toBeNull();
  });

  it("hides ยืนยันรับแทน when no receiver was named", () => {
    renderZone({ issues });
    expect(screen.queryByRole("button", { name: "ยืนยันรับแทน" })).toBeNull();
  });

  it("confirms on behalf after confirm", async () => {
    renderZone({ issues: pending });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันรับแทน" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockConfirmOB).toHaveBeenCalledWith({ issueId: "i1" }));
  });
});

// Spec 229 (ADR 0066 / S8) — the เบิก picker scopes its on-hand <select> to the
// WP's work-category via Relation R: the relevant stock surfaces under a ตรงกับงาน
// optgroup (kind_filter separating tools from materials), but NOTHING is hidden —
// every on-hand item stays selectable (D8 show-all). An empty relation → a flat
// list (the unchanged default).
const ELEC = "cat-elec";
const scopedOnHand: WpStockRow[] = [
  {
    catalogItemId: "wire",
    baseItem: "สายไฟ",
    specAttrs: null,
    unit: "ม้วน",
    qtyOnHand: 10,
    categoryId: ELEC,
    kind: "material",
  },
  {
    catalogItemId: "drill",
    baseItem: "สว่าน",
    specAttrs: null,
    unit: "ตัว",
    qtyOnHand: 3,
    categoryId: ELEC,
    kind: "tool",
  },
  {
    catalogItemId: "paint",
    baseItem: "สีรองพื้น",
    specAttrs: null,
    unit: "ถัง",
    qtyOnHand: 5,
    categoryId: "cat-paint",
    kind: "material",
  },
];

describe("WpIssueStock work-category scope (spec 229 / S8)", () => {
  function renderScoped(relation: ScopedMaterialCategory[]) {
    render(
      <WpIssueStock
        projectId="p1"
        workPackageId="wp1"
        onHand={scopedOnHand}
        workers={workers}
        issues={[]}
        scopedRelation={relation}
        membershipsByItem={new Map()}
      />,
    );
  }

  const realOptions = (select: HTMLSelectElement) =>
    [...select.querySelectorAll("option")].filter((o) => o.value !== "");

  it("groups the WP's materials under a ตรงกับงาน optgroup but keeps every item selectable", () => {
    renderScoped([{ categoryId: ELEC, kindFilter: null }]);
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    const select = screen.getAllByLabelText("วัสดุ")[0]! as HTMLSelectElement;
    const groups = [...select.querySelectorAll("optgroup")];
    expect(groups.some((g) => g.label.includes("ตรงกับงาน"))).toBe(true);
    // never hides: all three on-hand items remain as options.
    expect(
      realOptions(select)
        .map((o) => o.value)
        .sort(),
    ).toEqual(["drill", "paint", "wire"]);
  });

  it("separates tools from materials via kind_filter, still hiding nothing", () => {
    // Relation R: within ELEC, only TOOLS are relevant for this work-category.
    renderScoped([{ categoryId: ELEC, kindFilter: "tool" }]);
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    const select = screen.getAllByLabelText("วัสดุ")[0]! as HTMLSelectElement;
    const matchGroup = [...select.querySelectorAll("optgroup")].find((g) =>
      g.label.includes("ตรงกับงาน"),
    )!;
    const matchValues = [...matchGroup.querySelectorAll("option")].map((o) => o.value);
    expect(matchValues).toContain("drill"); // the tool surfaced
    expect(matchValues).not.toContain("wire"); // the material is NOT in the match group
    // but the material is still selectable elsewhere in the select.
    expect(select.querySelector('option[value="wire"]')).not.toBeNull();
  });

  it("shows a flat list (no scope grouping) when the WP has no Relation R", () => {
    renderScoped([]);
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    const select = screen.getAllByLabelText("วัสดุ")[0]! as HTMLSelectElement;
    expect(select.querySelectorAll("optgroup")).toHaveLength(0);
    expect(realOptions(select)).toHaveLength(3);
  });
});
