// Spec 302 — the pure visibility seam for the PR page's document sections.
// SA confusion (2026-07-12): at delivery time the page showed three document
// areas and an ungated payment uploader; ownership was never expressed. The
// page renders from this plan instead of inline conditionals so the matrix is
// unit-testable.

import type { PurchaseRequestStatus } from "@/lib/db/enums";

/** Statuses at which the การรับของ receive card exists (spec 300 U2). */
const RECEIVE_CARD_STATUSES: readonly PurchaseRequestStatus[] = ["on_route", "delivered"];

export type PaymentSectionMode = "uploader" | "view-only" | "missing-flag";

export interface RequestDocSectionPlan {
  /** Invoice thumbnails/PDFs render inside the การรับของ card. */
  invoiceDocsInReceiveCard: boolean;
  /** The standalone เอกสาร (ใบส่งของ/ใบเสร็จ) card renders (pre-delivery states only). */
  showStandaloneInvoiceCard: boolean;
  /**
   * หลักฐานการชำระเงิน: back-office and site-purchase (the SA paid) keep the
   * uploader; everyone else sees the slip view-only when procurement attached
   * one, or a one-line missing flag (no card, no button) when it hasn't —
   * hidden section, visible gap (operator refinement 2026-07-12).
   */
  paymentSection: PaymentSectionMode;
  /**
   * The reverse direction: back-office sees what the site still owes — an
   * amber one-liner when a DELIVERED PR has no ใบส่งของ/ใบเสร็จ photo. Never
   * shown to the SA (their own task already has the prompt + button), never
   * before the goods arrive.
   */
  invoiceMissingFlag: boolean;
}

export function planRequestDocSections(input: {
  status: PurchaseRequestStatus;
  isBackOffice: boolean;
  hasPaymentDocs: boolean;
  hasInvoiceDocs?: boolean;
}): RequestDocSectionPlan {
  const { status, isBackOffice, hasPaymentDocs, hasInvoiceDocs = false } = input;
  const atReceive = RECEIVE_CARD_STATUSES.includes(status);

  const paymentSection: PaymentSectionMode =
    isBackOffice || status === "site_purchased"
      ? "uploader"
      : hasPaymentDocs
        ? "view-only"
        : "missing-flag";

  return {
    invoiceDocsInReceiveCard: atReceive,
    showStandaloneInvoiceCard: !atReceive,
    paymentSection,
    invoiceMissingFlag: isBackOffice && status === "delivered" && !hasInvoiceDocs,
  };
}
