// Writing failing test first.
//
// Spec 331 §6 — the upload sheet's type picker: one grouped <select> (categories
// as optgroups, active types as options), the chosen type's hint shown beneath,
// and the two conditional form affordances the type's flags drive — a label field
// for MULTI types, a required-marked expiry for requires_expiry types.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocTypePicker } from "@/components/features/company-docs/doc-type-picker";
import type { DocTypeGroup, DocTypeRow } from "@/lib/company-docs/registry";
import { COMPANY_DOC_INSTANCE_LABEL, COMPANY_DOC_TYPE_LABEL } from "@/lib/i18n/labels";

const type = (over: Partial<DocTypeRow> & { code: string }): DocTypeRow => ({
  id: `type-${over.code}`,
  category_id: "cat-TAX",
  name_th: `ประเภท ${over.code}`,
  hint: null,
  is_singleton: true,
  is_required: false,
  requires_expiry: false,
  sort_order: 0,
  is_active: true,
  ...over,
});

const PP20 = type({ code: "TAX_PP20", name_th: "ภ.พ.20", hint: "ออกโดยกรมสรรพากร" });
const CAR = type({
  code: "INS_CAR",
  name_th: "กรมธรรม์ CAR",
  category_id: "cat-INS",
  is_singleton: false,
  requires_expiry: true,
});

const GROUPS: DocTypeGroup[] = [
  {
    category: { id: "cat-TAX", code: "TAX", name_th: "ภาษี", sort_order: 10, is_active: true },
    types: [PP20],
  },
  {
    category: { id: "cat-INS", code: "INS", name_th: "ประกันภัย", sort_order: 20, is_active: true },
    types: [CAR],
  },
];

describe("DocTypePicker", () => {
  it("renders every category as a group and every type as an option", () => {
    render(<DocTypePicker groups={GROUPS} selected={null} onSelect={vi.fn()} />);
    const select = screen.getByLabelText(COMPANY_DOC_TYPE_LABEL);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ภ.พ.20" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "กรมธรรม์ CAR" })).toBeInTheDocument();
  });

  it("reports the chosen type by id", () => {
    const onSelect = vi.fn();
    render(<DocTypePicker groups={GROUPS} selected={null} onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText(COMPANY_DOC_TYPE_LABEL), {
      target: { value: CAR.id },
    });
    expect(onSelect).toHaveBeenCalledWith(CAR);
  });

  it("shows the selected type's hint", () => {
    render(<DocTypePicker groups={GROUPS} selected={PP20} onSelect={vi.fn()} />);
    expect(screen.getByText("ออกโดยกรมสรรพากร")).toBeInTheDocument();
  });

  it("asks for a label only when the type allows several documents", () => {
    const { rerender } = render(
      <DocTypePicker groups={GROUPS} selected={PP20} onSelect={vi.fn()} />,
    );
    expect(screen.queryByLabelText(COMPANY_DOC_INSTANCE_LABEL)).not.toBeInTheDocument();
    rerender(<DocTypePicker groups={GROUPS} selected={CAR} onSelect={vi.fn()} />);
    expect(screen.getByLabelText(COMPANY_DOC_INSTANCE_LABEL)).toBeRequired();
  });

  // NOTE: the expiry field moved OUT of the picker into the sheet that owns the
  // form (they briefly lived in both, and form.get() read the picker's copy).
  // The requires_expiry behaviour is asserted in company-docs-grouping.test.tsx.
});
