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
  COMPANY_DOC_TITLE_LABEL,
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

const pdf = (name: string, bytes: number) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

describe("CompanyDocSheet picker", () => {
  it("shows the pick-area affordance, not a bare input", () => {
    render(<CompanyDocSheet mode={{ kind: "new" }} onClose={() => {}} />);
    expect(screen.getByText(COMPANY_DOC_PICK_LABEL)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_DOC_PICK_HINT)).toBeInTheDocument();
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    expect(input).toHaveClass("sr-only");
  });

  it("selecting a file flips to the chosen state with name + change affordance", () => {
    render(<CompanyDocSheet mode={{ kind: "new" }} onClose={() => {}} />);
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    fireEvent.change(input, { target: { files: [pdf("cert.pdf", 2048)] } });
    expect(screen.getByText("cert.pdf")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(COMPANY_DOC_PICK_CHANGE_LABEL))).toBeInTheDocument();
    expect(screen.queryByText(COMPANY_DOC_PICK_LABEL)).not.toBeInTheDocument();
  });

  it("reopening the sheet clears the previously picked file (stale-bytes guard)", () => {
    const { rerender } = render(<CompanyDocSheet mode={{ kind: "new" }} onClose={() => {}} />);
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    fireEvent.change(input, { target: { files: [pdf("old.pdf", 2048)] } });
    expect(screen.getByText("old.pdf")).toBeInTheDocument();
    rerender(<CompanyDocSheet mode={null} onClose={() => {}} />);
    rerender(<CompanyDocSheet mode={{ kind: "new" }} onClose={() => {}} />);
    expect(screen.queryByText("old.pdf")).not.toBeInTheDocument();
    expect(screen.getByText(COMPANY_DOC_PICK_LABEL)).toBeInTheDocument();
  });

  it("submit hands the picked file to the upload helper", async () => {
    const { uploadCompanyDocFile } = await import("@/lib/company-docs/upload-company-doc");
    vi.mocked(uploadCompanyDocFile).mockResolvedValue({ error: "stop-here" });
    render(<CompanyDocSheet mode={{ kind: "new" }} onClose={() => {}} />);
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    const file = pdf("real.pdf", 2048);
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(COMPANY_DOC_TITLE_LABEL), {
      target: { value: "ทดสอบ" },
    });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    await screen.findByText("stop-here");
    expect(vi.mocked(uploadCompanyDocFile).mock.calls[0]?.[0]?.name).toBe("real.pdf");
  });

  it("rejects an oversize file with the Thai limit message", () => {
    render(<CompanyDocSheet mode={{ kind: "new" }} onClose={() => {}} />);
    const input = screen.getByLabelText(COMPANY_DOC_PICK_LABEL, { selector: "input" });
    const big = pdf("huge.pdf", 10);
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByText(COMPANY_DOC_FILE_TOO_BIG)).toBeInTheDocument();
    expect(screen.queryByText("huge.pdf")).not.toBeInTheDocument();
  });
});
