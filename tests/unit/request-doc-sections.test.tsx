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
  PAYMENT_PROOF_FROM_PROCUREMENT_LABEL,
  PO_DOCS_FROM_PROCUREMENT_LABEL,
} from "@/lib/i18n/labels";

describe("planRequestDocSections (spec 302)", () => {
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

  it("non-back-office on a procurement-bought PR: hidden when empty, view-only when filled", () => {
    for (const status of ["purchased", "on_route", "delivered"] as const) {
      expect(
        planRequestDocSections({ status, isBackOffice: false, hasPaymentDocs: false })
          .paymentSection,
      ).toBe("hidden");
      expect(
        planRequestDocSections({ status, isBackOffice: false, hasPaymentDocs: true })
          .paymentSection,
      ).toBe("view-only");
    }
  });
});

describe("spec 302 labels (ui-term SSOT)", () => {
  it("the paper-capture prompt is an action verb", () => {
    expect(RECEIPT_PAPER_PROMPT).toBe("ถ่ายรูปใบส่งของ / ใบเสร็จที่มากับของ (ถ้ามี)");
  });

  it("procurement-provenance headings exist", () => {
    expect(PAYMENT_PROOF_FROM_PROCUREMENT_LABEL).toBe("สลิปโอนจากฝ่ายจัดซื้อ");
    expect(PO_DOCS_FROM_PROCUREMENT_LABEL).toBe("เอกสารจากฝ่ายจัดซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)");
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
