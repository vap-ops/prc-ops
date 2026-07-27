// Spec 177 U5 — เบิก at the WP detail (site_admin field-draw). A site staffer
// draws stock from the project store TO this work package. Mocked action + router.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Spec 363 U4 slice 1 — the item <select> became ScopedCatalogItemPicker (a
// trigger + a searchable BottomSheet), so tests pick by OPENING the picker for a
// row and clicking the item, instead of firing change on a select. What is
// asserted is unchanged; only the act of choosing moved.
function pickItem(_rowIndex: number, itemText: string | RegExp) {
  // A row that already has an item shows "เปลี่ยน" instead of the trigger, so
  // indexing the triggers breaks after the first pick. Tests fill rows in order,
  // so the FIRST remaining trigger is always the row being filled.
  const [trigger] = screen.getAllByRole("button", { name: "เลือกวัสดุจากคลัง" });
  fireEvent.click(trigger!);
  const match = typeof itemText === "string" ? new RegExp(itemText) : itemText;
  // Scope the click to the open sheet — the page behind it also lists items.
  // The เบิก form is itself a BottomSheet, so the picker opens a SECOND dialog
  // on top; the last one is the picker.
  const sheets = screen.getAllByRole("dialog");
  const sheet = sheets[sheets.length - 1]!;
  const [row] = within(sheet)
    .getAllByRole("button")
    .filter((b) => match.test(b.textContent ?? ""));
  fireEvent.click(row!);
}

// Spec 363 U4 slice 1b — the ผู้รับ <select> became a PersonPicker, so choosing a
// receiver now means opening its sheet and clicking the name. Mirrors pickItem.
// The เบิก grid is multi-row (spec 208 U3), so this takes the row index rather
// than always driving row 0. The picker's accessible name is
// "<field label> <trigger text>" (aria-labelledby), hence the regex.
const RECEIVER_TRIGGER = /ผู้รับ \(ถ้ามี\).*ไม่ระบุ/;
function pickReceiver(rowIndex: number, nameText: string | RegExp) {
  const triggers = screen.getAllByRole("button", { name: RECEIVER_TRIGGER });
  const trigger = triggers[rowIndex];
  if (!trigger) throw new Error(`no receiver trigger for row ${rowIndex}`);
  fireEvent.click(trigger);
  const match = typeof nameText === "string" ? new RegExp(nameText) : nameText;
  const sheets = screen.getAllByRole("dialog");
  const sheet = sheets[sheets.length - 1]!;
  const [row] = within(sheet)
    .getAllByRole("button")
    .filter((b) => match.test(b.textContent ?? ""));
  fireEvent.click(row!);
}

function renderZone(opts: { onHand?: WpStockRow[]; issues?: WpIssueRow[] }) {
  render(
    <WpIssueStock
      projectId="p1"
      workPackageId="wp1"
      onHand={opts.onHand ?? onHand}
      workers={workers}
      categories={[]}
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
    pickItem(0, "สายไฟ NYY");
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
    pickItem(0, "สายไฟ");
    fireEvent.change(screen.getAllByLabelText("จำนวน")[0]!, { target: { value: "5" } });
    // add row 2
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายการ/ }));
    pickItem(1, "ท่อ");
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
    pickItem(0, "สายไฟ NYY");
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    expect(submit).toBeEnabled();
  });

  // Spec 208 U2 — the client-side qty ceiling the sheet was missing: you cannot
  // เบิก more than is on hand (the server also 22023s, but block it before submit).
  it("blocks the submit when the qty exceeds what is on hand", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    pickItem(0, "สายไฟ NYY");
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "25" } });
    expect(screen.getByRole("button", { name: "ยืนยันการเบิก" })).toBeDisabled();
  });

  it("warns when the qty exceeds what is on hand", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    pickItem(0, "สายไฟ NYY");
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "25" } });
    expect(screen.getByText(/เกินจำนวนในคลัง/)).toBeInTheDocument();
  });

  it("allows the submit at exactly the on-hand qty", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    pickItem(0, "สายไฟ NYY");
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
    pickItem(0, "สายไฟ NYY");
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    pickReceiver(0, "สมชาย");
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssueBulk).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        lines: [{ catalogItemId: "ci1", qty: 5, note: "", receiverWorkerId: "w1" }],
      }),
    );
  });

  // Spec 363 U4 slice 1b — the consistency pin. Slice 1 left ผู้รับ as the last
  // native <select> beside the new material picker; this asserts the เบิก form now
  // has NO native select at all. Paired with a presence assertion on purpose: the
  // form lives inside a closed BottomSheet, so "no select found" passes trivially
  // on a fresh render whether or not the swap happened (the slice-1 self-correction).
  it("has no native select left in the เบิก form — both fields are pickers", () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    // Guard: the sheet really is open, so an empty select query means GONE.
    expect(screen.getByRole("button", { name: "ยืนยันการเบิก" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกวัสดุจากคลัง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RECEIVER_TRIGGER })).toBeInTheDocument();
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("lets the receiver be cleared back to ไม่ระบุ after a wrong pick", async () => {
    renderZone({});
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    pickItem(0, "สายไฟ NYY");
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    pickReceiver(0, "สมชาย");
    // Both fields are pickers now, so a filled row shows TWO เปลี่ยน controls.
    // วัสดุ renders above ผู้รับ, so the receiver's is the last one.
    const change = screen.getByRole("button", { name: /ผู้รับ \(ถ้ามี\).*เปลี่ยน/ });
    fireEvent.click(change);
    const sheets = screen.getAllByRole("dialog");
    fireEvent.click(within(sheets[sheets.length - 1]!).getByRole("button", { name: "ไม่ระบุ" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));

    await waitFor(() =>
      expect(mockIssueBulk).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        // An empty receiver OMITS the key (existing payload shape, unchanged here).
        lines: [{ catalogItemId: "ci1", qty: 5, note: "" }],
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
        categories={[]}
        issues={[]}
        scopedRelation={relation}
        membershipsByItem={new Map()}
      />,
    );
  }

  // Spec 363 U4 slice 1 — the <select>'s two <optgroup>s became the picker's
  // scoped-first ordering plus a per-row ตรงกับงาน / นอกหมวดงาน flag. What is
  // asserted is unchanged: the WP's materials surface first, kind_filter still
  // separates tools from materials, and NOTHING is hidden — the picker opens with
  // showAll defaulting to true, and its toggle NARROWS to matching rather than
  // revealing. (An earlier draft of this comment claimed the opposite; a probe of
  // the real sheet corrected it.)
  function openPicker() {
    fireEvent.click(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "เลือกวัสดุจากคลัง" })[0]!);
  }
  function sheetRows() {
    const sheets = screen.getAllByRole("dialog");
    return within(sheets[sheets.length - 1]!)
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").trim());
  }

  it("surfaces the WP's materials under ตรงกับงาน and hides nothing", () => {
    renderScoped([{ categoryId: ELEC, kindFilter: null }]);
    openPicker();
    const rows = sheetRows();
    expect(rows.some((r) => r.includes("สายไฟ") && r.includes("ตรงกับงาน"))).toBe(true);
    // never hides: every on-hand item is present, the off-scope one flagged.
    expect(rows.some((r) => r.includes("สีรองพื้น") && r.includes("นอกหมวดงาน"))).toBe(true);
    expect(rows.filter((r) => /ม้วน|ตัว|ถัง/.test(r))).toHaveLength(3);
  });

  it("separates tools from materials via kind_filter, still hiding nothing", () => {
    // Relation R: within ELEC, only TOOLS are relevant for this work-category.
    // This is the kind narrowing scopeStockRows does and the picker's own
    // category matcher does NOT — the reason the component is handed inScopeIds
    // instead of deriving scope itself.
    renderScoped([{ categoryId: ELEC, kindFilter: "tool" }]);
    openPicker();
    const rows = sheetRows();
    expect(rows.some((r) => r.includes("สว่าน") && r.includes("ตรงกับงาน"))).toBe(true);
    expect(rows.some((r) => r.includes("สายไฟ") && r.includes("ตรงกับงาน"))).toBe(false);
    // the material stays present and selectable, just flagged off-scope.
    expect(rows.some((r) => r.includes("สายไฟ"))).toBe(true);
  });

  it("shows a flat list (no scope flags) when the WP has no Relation R", () => {
    renderScoped([]);
    openPicker();
    const rows = sheetRows();
    expect(rows.some((r) => r.includes("ตรงกับงาน"))).toBe(false);
    expect(rows.some((r) => r.includes("นอกหมวดงาน"))).toBe(false);
    expect(rows.filter((r) => /ม้วน|ตัว|ถัง/.test(r))).toHaveLength(3);
  });

  it("shows the on-hand quantity as a badge on each row", () => {
    // The field complaint that opened this unit: the quantity used to be the tail
    // of a 118-character sentence inside a native <option>.
    renderScoped([]);
    openPicker();
    expect(sheetRows().some((r) => r.includes("10 ม้วน"))).toBe(true);
  });
});

// Spec 363 U4 — the ต้องการของ sheet renders this component for the เบิก path,
// INSIDE its own BottomSheet. Un-embedded that means the SA taps เบิกจากคลัง and
// lands on a second เบิกวัสดุจากคลัง button opening a THIRD nested sheet, with the
// recent-issues list stacked in between. `embedded` renders the form alone.
describe("WpIssueStock — embedded in the ต้องการของ sheet (spec 363 U4)", () => {
  function renderEmbedded() {
    render(
      <WpIssueStock
        projectId="p1"
        workPackageId="wp1"
        onHand={onHand}
        workers={workers}
        categories={[]}
        issues={issues}
        embedded
        initialCatalogItemId="ci1"
      />,
    );
  }

  it("renders the form directly — no second trigger to press", () => {
    renderEmbedded();
    expect(screen.getByRole("button", { name: "ยืนยันการเบิก" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เบิกวัสดุจากคลัง/ })).toBeNull();
  });

  it("opens no sheet of its own — the parent already is one", () => {
    renderEmbedded();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not repeat the recent-เบิก list inside the sheet", () => {
    // The ของ tab's own list already shows these; repeating them under the form
    // makes the sheet a scroll.
    renderEmbedded();
    expect(screen.queryByText("ท่อ PVC")).toBeNull();
  });

  it("arrives with the chosen item already selected", () => {
    renderEmbedded();
    expect(screen.getByText(/สายไฟ NYY/)).toBeInTheDocument();
  });

  it("still renders the trigger + list when NOT embedded", () => {
    // The เบิกของ tab keeps its existing shape until the tabs are retired.
    renderZone({ issues });
    expect(screen.getByRole("button", { name: /เบิกวัสดุจากคลัง/ })).toBeInTheDocument();
    expect(screen.getByText("ท่อ PVC")).toBeInTheDocument();
  });
});

// Spec 363 U4 — embedded, this component has no sheet of its own, so the two
// controls that assumed one are dead: the success path called setOpen(false)
// (blanking the form with NO confirmation — the SA cannot tell the เบิก happened
// and can submit it again, and stock_issues is append-only so the undo is a
// REVERSAL) and ยกเลิก called setOpen(false) too (tapping it did nothing).
describe("WpIssueStock — embedded terminal states (spec 363 U4)", () => {
  function renderEmbedded(onDone = vi.fn(), onCancel = vi.fn()) {
    render(
      <WpIssueStock
        projectId="p1"
        workPackageId="wp1"
        onHand={onHand}
        workers={workers}
        categories={[]}
        issues={[]}
        embedded
        initialCatalogItemId="ci1"
        onDone={onDone}
        onCancel={onCancel}
      />,
    );
    return { onDone, onCancel };
  }

  it("states the outcome in place instead of silently blanking the form", async () => {
    renderEmbedded();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));
    // A receipt naming what was withdrawn — not an empty form the SA re-submits.
    await waitFor(() => expect(screen.getByText(/เบิกแล้ว/)).toBeInTheDocument());
    expect(screen.getByText(/สายไฟ NYY/)).toBeInTheDocument();
    expect(screen.getByText(/5 ม้วน/)).toBeInTheDocument();
  });

  it("does not leave the submit button live after a successful เบิก", async () => {
    renderEmbedded();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));
    await waitFor(() => expect(screen.getByText(/เบิกแล้ว/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "ยืนยันการเบิก" })).toBeNull();
  });

  it("tells the parent it is finished only when the SA dismisses the receipt", async () => {
    const { onDone } = renderEmbedded();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเบิก" }));
    await waitFor(() => expect(screen.getByText(/เบิกแล้ว/)).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "เสร็จสิ้น" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("ยกเลิก calls back instead of doing nothing", () => {
    const { onCancel } = renderEmbedded();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
