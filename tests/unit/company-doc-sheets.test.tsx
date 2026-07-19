// Writing failing test first.
//
// Spec 329 follow-up (operator feedback 2026-07-19): the upload sheet's bare
// <input type="file"> was not intuitive. New picker = sr-only input behind a
// big dashed pick-area (expense-uploader idiom) that flips to a chosen state
// showing the file name + size, with a 25MB client-side pre-check (the bucket
// limit — its raw storage error is cryptic).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CompanyDocSheet } from "@/components/features/company-docs/company-doc-sheets";
import {
  COMPANY_DOC_FILE_TOO_BIG,
  COMPANY_DOC_PICK_CHANGE_LABEL,
  COMPANY_DOC_PICK_HINT,
  COMPANY_DOC_PICK_LABEL,
  COMPANY_DOC_TYPE_LABEL,
} from "@/lib/i18n/labels";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/company-docs/actions", () => ({
  addCompanyDocument: vi.fn(),
  addCompanyDocumentVersion: vi.fn(),
}));
vi.mock("@/lib/company-docs/upload-company-doc", () => ({
  uploadCompanyDocFile: vi.fn(),
}));

const GROUPS = [
  {
    category: {
      id: "cat-1",
      code: "REG",
      name_th: "จดทะเบียนบริษัท",
      sort_order: 10,
      is_active: true,
    },
    types: [
      {
        id: "type-1",
        category_id: "cat-1",
        code: "REG_CERT",
        name_th: "หนังสือรับรองบริษัท",
        hint: null,
        is_singleton: true,
        is_required: true,
        requires_expiry: false,
        sort_order: 10,
        is_active: true,
      },
    ],
  },
];

const pdf = (name: string, bytes: number) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

describe("CompanyDocSheet picker", () => {
  it("shows the pick-area affordance, not a bare input", () => {
    render(<CompanyDocSheet groups={GROUPS} mode={{ kind: "new" }} onClose={() => {}} />);
    expect(screen.getByText(COMPANY_DOC_PICK_LABEL)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_DOC_PICK_HINT)).toBeInTheDocument();
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    expect(input).toHaveClass("sr-only");
  });

  it("selecting a file flips to the chosen state with name + change affordance", () => {
    render(<CompanyDocSheet groups={GROUPS} mode={{ kind: "new" }} onClose={() => {}} />);
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    fireEvent.change(input, { target: { files: [pdf("cert.pdf", 2048)] } });
    expect(screen.getByText("cert.pdf")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(COMPANY_DOC_PICK_CHANGE_LABEL))).toBeInTheDocument();
    expect(screen.queryByText(COMPANY_DOC_PICK_LABEL)).not.toBeInTheDocument();
  });

  it("reopening the sheet clears the previously picked file (stale-bytes guard)", () => {
    const { rerender } = render(
      <CompanyDocSheet groups={GROUPS} mode={{ kind: "new" }} onClose={() => {}} />,
    );
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    fireEvent.change(input, { target: { files: [pdf("old.pdf", 2048)] } });
    expect(screen.getByText("old.pdf")).toBeInTheDocument();
    rerender(<CompanyDocSheet groups={GROUPS} mode={null} onClose={() => {}} />);
    rerender(<CompanyDocSheet groups={GROUPS} mode={{ kind: "new" }} onClose={() => {}} />);
    expect(screen.queryByText("old.pdf")).not.toBeInTheDocument();
    expect(screen.getByText(COMPANY_DOC_PICK_LABEL)).toBeInTheDocument();
  });

  it("submit hands the picked file to the upload helper", async () => {
    const { uploadCompanyDocFile } = await import("@/lib/company-docs/upload-company-doc");
    vi.mocked(uploadCompanyDocFile).mockResolvedValue({ error: "stop-here" });
    render(<CompanyDocSheet groups={GROUPS} mode={{ kind: "new" }} onClose={() => {}} />);
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    const file = pdf("real.pdf", 2048);
    fireEvent.change(input, { target: { files: [file] } });
    // Spec 331: the free-text title is gone — a type must be chosen instead.
    fireEvent.change(screen.getByLabelText(COMPANY_DOC_TYPE_LABEL), {
      target: { value: GROUPS[0]!.types[0]!.id },
    });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    await screen.findByText("stop-here");
    expect(vi.mocked(uploadCompanyDocFile).mock.calls[0]?.[0]?.name).toBe("real.pdf");
  });

  it("rejects an oversize file with the Thai limit message", () => {
    render(<CompanyDocSheet groups={GROUPS} mode={{ kind: "new" }} onClose={() => {}} />);
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    const big = pdf("huge.pdf", 10);
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByText(COMPANY_DOC_FILE_TOO_BIG)).toBeInTheDocument();
    expect(screen.queryByText("huge.pdf")).not.toBeInTheDocument();
  });
});
