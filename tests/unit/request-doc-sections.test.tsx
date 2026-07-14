// Writing failing test first.
//
// Spec 302 — receive-flow document clarity. SA confusion: at delivery time the
// PR page showed THREE document areas (receive-card capture, standalone เอกสาร
// card with "ยังไม่มีเอกสาร", and an ungated หลักฐานการชำระเงิน uploader) — the
// SA couldn't tell which papers were theirs to photograph and which belonged
// to procurement. planRequestDocSections is the pure visibility seam the page
// renders from; InvoiceDocsDisplay is the extracted doc-thumbnail block that
// now lives INSIDE the การรับของ card at on_route/delivered.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/requests/actions", () => ({
  removePurchaseRequestAttachment: vi.fn(),
}));

import { planRequestDocSections } from "@/lib/purchasing/request-doc-sections";
import { InvoiceDocsDisplay } from "@/components/features/purchasing/invoice-docs-display";
import {
  RECEIPT_PAPER_PROMPT,
  PO_DOCS_FROM_PROCUREMENT_LABEL,
  INVOICE_PAPER_MISSING_LABEL,
} from "@/lib/i18n/labels";

describe("planRequestDocSections (specs 302/304)", () => {
  it("at delivery statuses the invoice docs fold into the receive card and the standalone card disappears — all roles", () => {
    for (const status of ["on_route", "delivered"] as const) {
      for (const isBackOffice of [true, false]) {
        const plan = planRequestDocSections({ status, isBackOffice, hasPaymentDocs: false });
        expect(plan.invoiceDocsInReceiveCard).toBe(true);
        expect(plan.showStandaloneInvoiceCard).toBe(false);
      }
    }
  });

  it("pre-delivery / site-purchase states keep the standalone invoice card with its uploader", () => {
    for (const status of ["purchased", "site_purchased"] as const) {
      const plan = planRequestDocSections({ status, isBackOffice: false, hasPaymentDocs: false });
      expect(plan.invoiceDocsInReceiveCard).toBe(false);
      expect(plan.showStandaloneInvoiceCard).toBe(true);
    }
  });

  it("back-office keeps the payment uploader at every attachment-bearing status", () => {
    for (const status of ["purchased", "on_route", "delivered", "site_purchased"] as const) {
      const plan = planRequestDocSections({ status, isBackOffice: true, hasPaymentDocs: false });
      expect(plan.paymentSection).toBe("uploader");
    }
  });

  it("site-purchase keeps the payment uploader for non-back-office (the SA paid)", () => {
    const plan = planRequestDocSections({
      status: "site_purchased",
      isBackOffice: false,
      hasPaymentDocs: false,
    });
    expect(plan.paymentSection).toBe("uploader");
  });

  it("non-back-office on a procurement-bought PR sees NO payment surface at all (spec 304)", () => {
    // Operator doctrine: procurement's docs are not the SA's concern — not even
    // view-only, not even a missing one-liner. Docs present or absent, hidden.
    for (const status of ["purchased", "on_route", "delivered"] as const) {
      for (const hasPaymentDocs of [false, true]) {
        expect(
          planRequestDocSections({ status, isBackOffice: false, hasPaymentDocs }).paymentSection,
        ).toBe("hidden");
      }
    }
  });

  it("PO-docs section is back-office only (spec 304)", () => {
    for (const status of ["purchased", "on_route", "delivered", "site_purchased"] as const) {
      expect(
        planRequestDocSections({ status, isBackOffice: true, hasPaymentDocs: false })
          .showPoDocsSection,
      ).toBe(true);
      expect(
        planRequestDocSections({ status, isBackOffice: false, hasPaymentDocs: false })
          .showPoDocsSection,
      ).toBe(false);
    }
  });

  it("flags the missing paper doc to back-office on a delivered PR only", () => {
    // The reverse-direction flag (operator 2026-07-12): back-office sees what
    // the site still owes — only once goods arrived, only when nothing attached.
    expect(
      planRequestDocSections({ status: "delivered", isBackOffice: true, hasPaymentDocs: false })
        .invoiceMissingFlag,
    ).toBe(true);
    expect(
      planRequestDocSections({
        status: "delivered",
        isBackOffice: true,
        hasPaymentDocs: false,
        hasInvoiceDocs: true,
      }).invoiceMissingFlag,
    ).toBe(false);
    // Not the SA's nag — their own task already has the prompt + button.
    expect(
      planRequestDocSections({ status: "delivered", isBackOffice: false, hasPaymentDocs: false })
        .invoiceMissingFlag,
    ).toBe(false);
    // Paper can't exist before the goods arrive.
    expect(
      planRequestDocSections({ status: "on_route", isBackOffice: true, hasPaymentDocs: false })
        .invoiceMissingFlag,
    ).toBe(false);
  });
});

describe("spec 302 labels (ui-term SSOT)", () => {
  it("the paper-capture prompt is an action verb", () => {
    expect(RECEIPT_PAPER_PROMPT).toBe("ถ่ายรูปใบส่งของ / ใบเสร็จที่มากับของ (ถ้ามี)");
  });

  it("procurement-provenance heading exists (BO-only surface, spec 304)", () => {
    expect(PO_DOCS_FROM_PROCUREMENT_LABEL).toBe("เอกสารจากฝ่ายจัดซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)");
  });

  it("missing-doc flag copy exists (procurement sees the site's gap)", () => {
    expect(INVOICE_PAPER_MISSING_LABEL).toBe("ยังไม่มีใบส่งของ / ใบเสร็จจากหน้างาน");
  });
});

describe("InvoiceDocsDisplay", () => {
  const urls = new Map<string, string>([
    ["img1", "https://signed.example/img1"],
    ["pdf1", "https://signed.example/pdf1"],
  ]);

  it("renders image thumbnails and PDF viewers from the url map", () => {
    const { container } = render(
      <InvoiceDocsDisplay
        images={[{ id: "img1", created_by: "u-other" }]}
        pdfs={[{ id: "pdf1", created_by: "u-other" }]}
        urls={urls}
        viewerId="u-viewer"
      />,
    );
    expect(container.querySelectorAll("img").length).toBe(1);
    expect(container.querySelectorAll("iframe").length).toBe(1);
  });

  it("shows the remove button only on the viewer's own uploads", () => {
    render(
      <InvoiceDocsDisplay
        images={[
          { id: "img1", created_by: "u-viewer" },
          { id: "img2", created_by: "u-other" },
        ]}
        pdfs={[]}
        urls={
          new Map([
            ["img1", "https://signed.example/img1"],
            ["img2", "https://signed.example/img2"],
          ])
        }
        viewerId="u-viewer"
      />,
    );
    expect(screen.getAllByRole("button", { name: "ลบ" }).length).toBe(1);
  });

  it("renders nothing when there are no docs", () => {
    const { container } = render(
      <InvoiceDocsDisplay images={[]} pdfs={[]} urls={new Map()} viewerId="u-viewer" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
