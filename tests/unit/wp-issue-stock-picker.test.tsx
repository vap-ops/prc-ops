// Writing failing test first.
//
// Spec 363 U4 slice 1 — the เบิก item picker moves off a native <select>.
//
// Field report 2026-07-27 (operator screenshot): the OS-rendered select sheet
// showed 369 on-hand options, labels up to 118 characters wrapping to three
// lines, no search, and three rows that differ only by สีน้ำตาล / สีฟ้า / สีดำ
// after ~45 identical characters. A native <select> cannot be styled, searched,
// or grouped beyond <optgroup> — the sheet belongs to the platform. ขอซื้อ and
// ซื้อเอง already use ScopedCatalogItemPicker; เบิก was the one left behind.
//
// What must survive the swap: the kind-aware scope (spec 229). เบิก scopes with
// scopeStockRows, which narrows by category AND kind; the picker's own matcher
// is category-only, so the component must receive the decision, not re-derive it.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/store/actions", () => ({
  issueStockBulk: vi.fn().mockResolvedValue({ ok: true }),
  confirmStockIssueOnBehalf: vi.fn().mockResolvedValue({ ok: true }),
  reverseStockIssue: vi.fn().mockResolvedValue({ ok: true }),
}));

import { WpIssueStock, type WpStockRow } from "@/components/features/store/wp-issue-stock";

const CAT_ELEC = "11111111-1111-1111-1111-111111111111";

const ON_HAND: WpStockRow[] = [
  {
    catalogItemId: "i1",
    baseItem: "สายไฟ THW 450/750",
    specAttrs: "1x4 ตร.มม. สีน้ำตาล Yazaki 100 เมตร",
    unit: "ม้วน",
    qtyOnHand: 6,
    categoryId: CAT_ELEC,
    kind: "material",
  },
  {
    catalogItemId: "i2",
    baseItem: "สายไฟ THW 450/750",
    specAttrs: "1x4 ตร.มม. สีฟ้า Yazaki 100 เมตร",
    unit: "ม้วน",
    qtyOnHand: 5,
    categoryId: CAT_ELEC,
    kind: "material",
  },
];

const PROPS = {
  projectId: "p1",
  workPackageId: "w1",
  onHand: ON_HAND,
  workers: [{ id: "u1", name: "อนัญญา" }],
  issues: [],
  categories: [{ id: CAT_ELEC, name: "ไฟฟ้า" }],
};

// The เบิก form lives inside a BottomSheet that is CLOSED on mount, so asserting
// "no select exists" against a fresh render passes whether or not the swap
// happened — the first version of this test did exactly that and passed against
// the unmodified component. Every case must open the sheet first.
function openIssueForm() {
  fireEvent.click(screen.getByRole("button", { name: "เบิกวัสดุจากคลัง" }));
}

describe("WpIssueStock — the item picker", () => {
  it("no longer renders a native select for the item", () => {
    render(<WpIssueStock {...PROPS} />);
    openIssueForm();
    // BottomSheet renders through a portal, so query the document, not the
    // component's container. Guard the guard: an empty select result must mean
    // GONE, not never-rendered. Slice 1 used the receiver <select> as that proof;
    // slice 1b removed it too (there is now no select on this form at all), so
    // the proof moved to the form's own submit button, which only exists once the
    // sheet is open. Deliberate update — the old guard failing here is correct.
    expect(screen.getByRole("button", { name: "ยืนยันการเบิก" })).toBeInTheDocument();
    const selects = [...document.body.querySelectorAll("select")];
    expect(selects.filter((s) => (s.id ?? "").startsWith("wp-issue-item"))).toHaveLength(0);
  });

  it("renders the searchable picker trigger instead", () => {
    render(<WpIssueStock {...PROPS} />);
    openIssueForm();
    // The picker's trigger carries the field label; the sheet owns the search.
    expect(screen.getByText("วัสดุในคลัง")).toBeInTheDocument();
  });
});
