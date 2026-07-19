// Writing failing test first.
//
// Spec 331 — the two pure readers behind the type-driven library:
//   groupTypesByCategory — the upload picker's grouped option list (active only,
//     sorted by the registry's sort_order, empty categories dropped)
//   missingRequiredTypes — the ยังขาด checklist: every ACTIVE + REQUIRED type with
//     no live document. This is what "standardize" buys the operator.
// Both take plain row shapes (the generated Tables<> rows satisfy them), so they
// stay unit-testable without a DB round trip.

import { describe, expect, it } from "vitest";
import {
  groupTypesByCategory,
  missingRequiredTypes,
  type DocCategoryRow,
  type DocTypeRow,
} from "@/lib/company-docs/registry";

const cat = (over: Partial<DocCategoryRow> & { code: string }): DocCategoryRow => ({
  id: `cat-${over.code}`,
  name_th: `หมวด ${over.code}`,
  sort_order: 0,
  is_active: true,
  ...over,
});

const type = (over: Partial<DocTypeRow> & { code: string; category_id: string }): DocTypeRow => ({
  id: `type-${over.code}`,
  name_th: `ประเภท ${over.code}`,
  hint: null,
  is_singleton: true,
  is_required: false,
  requires_expiry: false,
  sort_order: 0,
  is_active: true,
  ...over,
});

const REG = cat({ code: "REG", sort_order: 10 });
const TAX = cat({ code: "TAX", sort_order: 20 });

describe("groupTypesByCategory", () => {
  it("groups active types under their category, both sorted by sort_order", () => {
    const groups = groupTypesByCategory(
      [TAX, REG],
      [
        type({ code: "TAX_PP20", category_id: TAX.id, sort_order: 10 }),
        type({ code: "REG_MOA", category_id: REG.id, sort_order: 20 }),
        type({ code: "REG_CERT", category_id: REG.id, sort_order: 10 }),
      ],
    );
    expect(groups.map((g) => g.category.code)).toEqual(["REG", "TAX"]);
    expect(groups[0]?.types.map((t) => t.code)).toEqual(["REG_CERT", "REG_MOA"]);
  });

  it("drops inactive types, inactive categories, and categories left empty", () => {
    const groups = groupTypesByCategory(
      [REG, TAX, cat({ code: "OLD", is_active: false })],
      [
        type({ code: "REG_CERT", category_id: REG.id }),
        type({ code: "TAX_PP20", category_id: TAX.id, is_active: false }),
      ],
    );
    expect(groups.map((g) => g.category.code)).toEqual(["REG"]);
  });
});

describe("missingRequiredTypes", () => {
  const required = type({ code: "TAX_PP20", category_id: TAX.id, is_required: true });
  const optional = type({ code: "TAX_PP01", category_id: TAX.id, is_required: false });

  it("lists a required type with no live document", () => {
    expect(missingRequiredTypes([required, optional], []).map((t) => t.code)).toEqual(["TAX_PP20"]);
  });

  it("drops a required type once a live document exists", () => {
    expect(missingRequiredTypes([required, optional], [{ type_id: required.id }])).toEqual([]);
  });

  it("ignores documents of other types", () => {
    expect(missingRequiredTypes([required], [{ type_id: optional.id }]).map((t) => t.code)).toEqual(
      ["TAX_PP20"],
    );
  });

  it("never lists an inactive required type", () => {
    const retired = type({
      code: "TAX_OLD",
      category_id: TAX.id,
      is_required: true,
      is_active: false,
    });
    expect(missingRequiredTypes([retired], [])).toEqual([]);
  });

  it("keeps the registry order", () => {
    const a = type({ code: "A", category_id: TAX.id, is_required: true, sort_order: 20 });
    const b = type({ code: "B", category_id: TAX.id, is_required: true, sort_order: 10 });
    expect(missingRequiredTypes([a, b], []).map((t) => t.code)).toEqual(["B", "A"]);
  });
});
