// Spec 302 — the pure visibility seam for the PR page's document sections.
// SA confusion (2026-07-12): at delivery time the page showed three document
// areas and an ungated payment uploader; ownership was never expressed. The
// page renders from this plan instead of inline conditionals so the matrix is
// unit-testable.

import type { PurchaseRequestStatus } from "@/lib/db/enums";

/** Statuses at which the การรับของ receive card exists (spec 300 U2). */
const RECEIVE_CARD_STATUSES: readonly PurchaseRequestStatus[] = ["on_route", "delivered"];

export type PaymentSectionMode = "uploader" | "hidden";

export interface RequestDocSectionPlan {
  /** Invoice thumbnails/PDFs render inside the การรับของ card. */
  invoiceDocsInReceiveCard: boolean;
  /** The standalone เอกสาร (ใบส่งของ/ใบเสร็จ) card renders (pre-delivery states only). */
  showStandaloneInvoiceCard: boolean;
  /**
   * หลักฐานการชำระเงิน: back-office and site-purchase (the SA paid — their own
   * doc) get the uploader; everyone else gets NOTHING (spec 304 asymmetry:
   * procurement's docs are not the SA's concern — not even view-only).
   */
  paymentSection: PaymentSectionMode;
  /** เอกสารจากฝ่ายจัดซื้อ (PO docs) — back-office only (spec 304 asymmetry). */
  showPoDocsSection: boolean;
  /**
   * The reverse direction: back-office sees what the site still owes — an
   * amber one-liner when a DELIVERED PR has no ใบส่งของ/ใบเสร็จ photo. Never
   * shown to the SA (their own task already has the prompt + button), never
   * before the goods arrive.
   */
  invoiceMissingFlag: boolean;
  /**
   * Spec 303: a delivered PR with ZERO confirmation photos has no receive
   * proof (the BO checklist path can produce this) — amber flag for EVERY
   * role; the goods photo is the core evidence.
   */
  deliveryPhotoMissingFlag: boolean;
}

export function planRequestDocSections(input: {
  status: PurchaseRequestStatus;
  isBackOffice: boolean;
  /** Unused since spec 304 (payment visibility no longer depends on docs);
   *  kept so existing call sites/tests stay source-compatible. */
  hasPaymentDocs?: boolean;
  hasInvoiceDocs?: boolean;
  hasDeliveryPhotos?: boolean;
}): RequestDocSectionPlan {
  const { status, isBackOffice, hasInvoiceDocs = false, hasDeliveryPhotos = false } = input;
  const atReceive = RECEIVE_CARD_STATUSES.includes(status);

  const paymentSection: PaymentSectionMode =
    isBackOffice || status === "site_purchased" ? "uploader" : "hidden";

  return {
    invoiceDocsInReceiveCard: atReceive,
    showStandaloneInvoiceCard: !atReceive,
    paymentSection,
    showPoDocsSection: isBackOffice,
    invoiceMissingFlag: isBackOffice && status === "delivered" && !hasInvoiceDocs,
    deliveryPhotoMissingFlag: status === "delivered" && !hasDeliveryPhotos,
  };
}
