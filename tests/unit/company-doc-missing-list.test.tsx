// Writing failing test first.
//
// Spec 331 §6 — the ยังขาด section: the required types the company has no live
// document for, each with an inline upload affordance. Renders a done-state when
// nothing is missing, and stays invisible to read-only viewers (they cannot act
// on it, so it would only nag).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissingDocsList } from "@/components/features/company-docs/missing-docs-list";
import type { DocTypeRow } from "@/lib/company-docs/registry";
import {
  COMPANY_DOC_MISSING_HEADING,
  COMPANY_DOC_MISSING_NONE,
  COMPANY_DOC_UPLOAD_LABEL,
} from "@/lib/i18n/labels";

const type = (over: Partial<DocTypeRow> & { code: string }): DocTypeRow => ({
  id: `type-${over.code}`,
  category_id: "cat-1",
  name_th: `ประเภท ${over.code}`,
  hint: null,
  is_singleton: true,
  is_required: true,
  requires_expiry: false,
  sort_order: 0,
  is_active: true,
  ...over,
});

describe("MissingDocsList", () => {
  it("lists each missing required type by its Thai name", () => {
    render(
      <MissingDocsList
        missing={[
          type({ code: "TAX_PP20", name_th: "ภ.พ.20" }),
          type({ code: "REG_CERT", name_th: "หนังสือรับรองบริษัท" }),
        ]}
        canManage={true}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getByText(new RegExp(COMPANY_DOC_MISSING_HEADING))).toBeInTheDocument();
    expect(screen.getByText("ภ.พ.20")).toBeInTheDocument();
    expect(screen.getByText("หนังสือรับรองบริษัท")).toBeInTheDocument();
  });

  it("gives each row an upload affordance for managers", () => {
    render(
      <MissingDocsList
        missing={[type({ code: "TAX_PP20" })]}
        canManage={true}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button", { name: COMPANY_DOC_UPLOAD_LABEL })).toHaveLength(1);
  });

  it("shows the done state when nothing is missing", () => {
    render(<MissingDocsList missing={[]} canManage={true} onUpload={vi.fn()} />);
    expect(screen.getByText(COMPANY_DOC_MISSING_NONE)).toBeInTheDocument();
  });

  it("renders nothing at all for read-only viewers", () => {
    const { container } = render(
      <MissingDocsList
        missing={[type({ code: "TAX_PP20" })]}
        canManage={false}
        onUpload={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
