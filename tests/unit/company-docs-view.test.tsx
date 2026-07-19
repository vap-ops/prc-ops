// Writing failing test first.
//
// Spec 329 U2 — the /settings/company-docs list: one card per current doc,
// expiry badges off expires_at vs todayIso, manage controls only for
// canManage (accounting tier), history disclosure with per-version download
// links, empty state. Server actions + upload are exercised in their own
// test — here the wiring surface is pinned.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/company-docs/actions", () => ({
  retireCompanyDocument: vi.fn(),
  mintCompanyDocShareLink: vi.fn(),
  addCompanyDocument: vi.fn(),
  addCompanyDocumentVersion: vi.fn(),
}));
vi.mock("@/lib/company-docs/upload-company-doc", () => ({
  uploadCompanyDocFile: vi.fn(),
}));
import { CompanyDocsView } from "@/components/features/company-docs/company-docs-view";
import type { CompanyDocument } from "@/lib/company-docs/group-documents";
import {
  COMPANY_DOC_DOWNLOAD_LABEL,
  COMPANY_DOC_EMPTY_LABEL,
  COMPANY_DOC_EXPIRED_LABEL,
  COMPANY_DOC_EXPIRING_LABEL,
  COMPANY_DOC_HISTORY_LABEL,
  COMPANY_DOC_NEW_VERSION_LABEL,
  COMPANY_DOC_RETIRE_LABEL,
  COMPANY_DOC_UPLOAD_OTHER_LABEL,
} from "@/lib/i18n/labels";

const row = (over: Partial<CompanyDocument["head"]>): CompanyDocument["head"] => ({
  id: "a",
  title: "หนังสือรับรองบริษัท",
  note: null,
  storage_path: "a/cert.pdf",
  issued_at: "2026-02-12",
  expires_at: null,
  superseded_by: null,
  created_by: "u",
  created_at: "2026-07-01T00:00:00Z",
  // Spec 331 columns — the identity + multi-instance label.
  type_id: null,
  label: null,
  ...over,
});

const TODAY = "2026-07-19";

describe("CompanyDocsView", () => {
  it("renders a card per doc with download + share, and an expiring badge inside 30 days", () => {
    const docs: CompanyDocument[] = [
      { head: row({ id: "a", expires_at: "2026-08-10" }), history: [] },
      { head: row({ id: "b", title: "ภ.พ.20", storage_path: "b/vat.pdf" }), history: [] },
    ];
    render(
      <CompanyDocsView
        docs={docs}
        downloadUrls={{ a: "https://s/a", b: "https://s/b" }}
        canManage={false}
        todayIso={TODAY}
      />,
    );
    expect(screen.getByText("หนังสือรับรองบริษัท")).toBeInTheDocument();
    expect(screen.getByText("ภ.พ.20")).toBeInTheDocument();
    expect(screen.getByText(COMPANY_DOC_EXPIRING_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(COMPANY_DOC_EXPIRED_LABEL)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: COMPANY_DOC_DOWNLOAD_LABEL })).toHaveLength(2);
  });

  it("shows the expired badge for a past date", () => {
    render(
      <CompanyDocsView
        docs={[{ head: row({ expires_at: "2026-06-15" }), history: [] }]}
        downloadUrls={{ a: "https://s/a" }}
        canManage={false}
        todayIso={TODAY}
      />,
    );
    expect(screen.getByText(COMPANY_DOC_EXPIRED_LABEL)).toBeInTheDocument();
  });

  it("hides every manage control for read-only viewers", () => {
    render(
      <CompanyDocsView
        docs={[{ head: row({}), history: [] }]}
        downloadUrls={{ a: "https://s/a" }}
        canManage={false}
        todayIso={TODAY}
      />,
    );
    expect(screen.queryByText(COMPANY_DOC_UPLOAD_OTHER_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(COMPANY_DOC_NEW_VERSION_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(COMPANY_DOC_RETIRE_LABEL)).not.toBeInTheDocument();
  });

  it("shows manage controls for the accounting tier", () => {
    render(
      <CompanyDocsView
        docs={[{ head: row({}), history: [] }]}
        downloadUrls={{ a: "https://s/a" }}
        canManage={true}
        todayIso={TODAY}
      />,
    );
    expect(screen.getByText(COMPANY_DOC_UPLOAD_OTHER_LABEL)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_DOC_NEW_VERSION_LABEL)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_DOC_RETIRE_LABEL)).toBeInTheDocument();
  });

  it("renders history versions with their own download links", () => {
    const docs: CompanyDocument[] = [
      {
        head: row({ id: "c2", storage_path: "c2/cert.pdf" }),
        history: [row({ id: "c1", storage_path: "c1/cert.pdf" })],
      },
    ];
    render(
      <CompanyDocsView
        docs={docs}
        downloadUrls={{ c2: "https://s/c2", c1: "https://s/c1" }}
        canManage={false}
        todayIso={TODAY}
      />,
    );
    expect(screen.getByText(new RegExp(COMPANY_DOC_HISTORY_LABEL))).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: COMPANY_DOC_DOWNLOAD_LABEL });
    expect(links.map((l) => l.getAttribute("href"))).toContain("https://s/c1");
  });

  it("renders the empty state without docs", () => {
    render(<CompanyDocsView docs={[]} downloadUrls={{}} canManage={false} todayIso={TODAY} />);
    expect(screen.getByText(COMPANY_DOC_EMPTY_LABEL)).toBeInTheDocument();
  });
});
