// Spec 302 — the pure visibility seam for the PR page's document sections.
// SA confusion (2026-07-12): at delivery time the page showed three document
// areas and an ungated payment uploader; ownership was never expressed. The
// page renders from this plan instead of inline conditionals so the matrix is
// unit-testable.

import type { PurchaseRequestStatus } from "@/lib/db/enums";

/** Statuses at which the การรับของ receive card exists (spec 300 U2). */
const RECEIVE_CARD_STATUSES: readonly PurchaseRequestStatus[] = ["on_route", "delivered"];

export type PaymentSectionMode = "uploader" | "view-only" | "hidden";

export interface RequestDocSectionPlan {
  /** Invoice thumbnails/PDFs render inside the การรับของ card. */
  invoiceDocsInReceiveCard: boolean;
  /** The standalone เอกสาร (ใบส่งของ/ใบเสร็จ) card renders (pre-delivery states only). */
  showStandaloneInvoiceCard: boolean;
  /**
   * หลักฐานการชำระเงิน: back-office and site-purchase (the SA paid) keep the
   * uploader; everyone else sees the slip view-only when procurement attached
   * one, and nothing at all when the section would be empty.
   */
  paymentSection: PaymentSectionMode;
}

export function planRequestDocSections(input: {
  status: PurchaseRequestStatus;
  isBackOffice: boolean;
  hasPaymentDocs: boolean;
}): RequestDocSectionPlan {
  const { status, isBackOffice, hasPaymentDocs } = input;
  const atReceive = RECEIVE_CARD_STATUSES.includes(status);

  const paymentSection: PaymentSectionMode =
    isBackOffice || status === "site_purchased"
      ? "uploader"
      : hasPaymentDocs
        ? "view-only"
        : "hidden";

  return {
    invoiceDocsInReceiveCard: atReceive,
    showStandaloneInvoiceCard: !atReceive,
    paymentSection,
  };
}
