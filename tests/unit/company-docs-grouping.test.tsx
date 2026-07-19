// Writing failing test first.
//
// Operator feedback 2026-07-19 on the shipped page, three defects:
//   1. the documents list is FLAT — spec 331 §6 says cards group under their
//      category heading (the registry exists precisely to make that possible)
//   2. a shouting อัปโหลดเอกสาร button sits at the TOP, though ยังขาด now drives
//      the required uploads with per-row buttons; the generic action only covers
//      extras (insurance, ISO) and belongs at the END, quietly
//   3. the upload sheet renders TWO date pairs — the picker's and the sheet's —
//      and form.get() reads the FIRST, so anything typed in the visible lower
//      pair was silently discarded

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CompanyDocsView } from "@/components/features/company-docs/company-docs-view";
import { CompanyDocSheet } from "@/components/features/company-docs/company-doc-sheets";
import type { CompanyDocument } from "@/lib/company-docs/group-documents";
import type { DocTypeGroup, DocTypeRow } from "@/lib/company-docs/registry";
import { COMPANY_DOC_UPLOAD_OTHER_LABEL } from "@/lib/i18n/labels";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/company-docs/actions", () => ({
  retireCompanyDocument: vi.fn(),
  mintCompanyDocShareLink: vi.fn(),
  addCompanyDocument: vi.fn(),
  addCompanyDocumentVersion: vi.fn(),
}));
vi.mock("@/lib/company-docs/upload-company-doc", () => ({ uploadCompanyDocFile: vi.fn() }));

const TAX = { id: "cat-TAX", code: "TAX", name_th: "ภาษี", sort_order: 20, is_active: true };
const REG = {
  id: "cat-REG",
  code: "REG",
  name_th: "จดทะเบียนบริษัท",
  sort_order: 10,
  is_active: true,
};

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

const PP20 = type({ code: "TAX_PP20", category_id: TAX.id, name_th: "ภ.พ.20" });
const CERT = type({ code: "REG_CERT", category_id: REG.id, name_th: "หนังสือรับรองบริษัท" });
const CAR = type({
  code: "INS_CAR",
  category_id: TAX.id,
  name_th: "กรมธรรม์ CAR",
  is_singleton: false,
  requires_expiry: true,
});

const GROUPS: DocTypeGroup[] = [
  { category: REG, types: [CERT] },
  { category: TAX, types: [PP20, CAR] },
];
const TYPES_BY_ID = { [PP20.id]: PP20, [CERT.id]: CERT, [CAR.id]: CAR };

const doc = (id: string, typeId: string): CompanyDocument => ({
  head: {
    id,
    title: "snapshot",
    note: null,
    storage_path: `${id}/f.pdf`,
    issued_at: null,
    expires_at: null,
    superseded_by: null,
    created_by: "u",
    created_at: "2026-07-01T00:00:00Z",
    type_id: typeId,
    label: null,
  },
  history: [],
});

describe("documents grouped by category (operator feedback 1)", () => {
  it("renders a heading per category, each holding only its own documents", () => {
    render(
      <CompanyDocsView
        docs={[doc("d1", PP20.id), doc("d2", CERT.id)]}
        downloadUrls={{}}
        canManage={true}
        todayIso="2026-07-19"
        groups={GROUPS}
        typesById={TYPES_BY_ID}
        missing={[]}
      />,
    );
    const regSection = screen.getByRole("region", { name: REG.name_th });
    const taxSection = screen.getByRole("region", { name: TAX.name_th });
    expect(within(regSection).getByText("หนังสือรับรองบริษัท")).toBeInTheDocument();
    expect(within(regSection).queryByText("ภ.พ.20")).not.toBeInTheDocument();
    expect(within(taxSection).getByText("ภ.พ.20")).toBeInTheDocument();
  });

  it("shows a category only when it holds documents", () => {
    render(
      <CompanyDocsView
        docs={[doc("d1", PP20.id)]}
        downloadUrls={{}}
        canManage={true}
        todayIso="2026-07-19"
        groups={GROUPS}
        typesById={TYPES_BY_ID}
        missing={[]}
      />,
    );
    expect(screen.queryByRole("region", { name: REG.name_th })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: TAX.name_th })).toBeInTheDocument();
  });
});

describe("the generic upload action (operator feedback 2)", () => {
  it("is a quiet end-of-page action, not a top-of-page banner", () => {
    const { container } = render(
      <CompanyDocsView
        docs={[doc("d1", PP20.id)]}
        downloadUrls={{}}
        canManage={true}
        todayIso="2026-07-19"
        groups={GROUPS}
        typesById={TYPES_BY_ID}
        missing={[]}
      />,
    );
    const btn = screen.getByRole("button", { name: COMPANY_DOC_UPLOAD_OTHER_LABEL });
    const card = screen.getByText("ภ.พ.20");
    // it must come AFTER the documents in document order
    expect(btn.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(container.firstElementChild?.contains(btn)).toBe(true);
  });
});

describe("upload sheet dates (operator feedback 3)", () => {
  it("renders exactly one issue-date and one expiry-date input", () => {
    render(<CompanyDocSheet groups={GROUPS} mode={{ kind: "new" }} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll('input[name="issued_at"]')).toHaveLength(1);
    expect(dialog.querySelectorAll('input[name="expires_at"]')).toHaveLength(1);
  });

  it("still marks expiry required for a type that demands it", () => {
    render(
      <CompanyDocSheet
        groups={GROUPS}
        mode={{ kind: "new", lockedType: CAR }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("company-doc-expires")).toBeRequired();
  });
});
