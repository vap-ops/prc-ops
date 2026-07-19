// Spec 263 U3 — pure view-model for the back-office approval queue row. Pure
// (no Supabase, no server-only — same discipline as card-view.ts /
// document-types.ts): the data layer reads the raw rows + attachment purposes,
// this module shapes them for the list. `meetsApprovalFloor` mirrors the U1c
// `approve_technician_registration` RPC's completeness floor EXACTLY (full_name
// present AND a live id_card attachment) so the queue can flag an incomplete
// applicant before the reviewer opens the detail and hits the RPC's floor
// rejection — UI hint only, the RPC remains the authoritative gate.

import type { Database } from "@/lib/db/database.types";
import { STAFF_DOC_PURPOSES, type StaffDocPurpose } from "./document-types";

type RegistrationStatus = Database["public"]["Enums"]["registration_status"];

export interface RegistrationQueueInput {
  id: string;
  employeeId: string;
  fullName: string | null;
  status: RegistrationStatus;
  createdAt: string;
  /** The live (current, supersede-head) attachment purposes on this registration. */
  uploadedPurposes: readonly StaffDocPurpose[];
  /** Spec 296 — whether a staff_registration_bank row exists (the bank data is
   *  zero-grant, so the data layer supplies only this presence boolean). */
  hasBank: boolean;
  /** Spec 322 — whether the row carries a reviewer note (reject_reason non-blank).
   *  On a PENDING row this means it was SENT BACK for edit; the queue flags it. */
  hasReviewerNote: boolean;
  /** Spec 328 U3 — the firm whose QR invited this applicant
   *  (staff_registrations.invited_contractor_id, advisory). Presence makes the
   *  row BANK-EXEMPT in the floor hint (mirrors the approve RPC's contractor
   *  arm, which skips the book_bank + bank-row floors) and surfaces a firm chip.
   *  Trustworthy enough for a hint: start_staff_registration existence-coerces
   *  the visitor-supplied id (a forged uuid never lands in the column), and a
   *  later-deleted firm SET-NULLs it. `name` is null only when the id no longer
   *  resolves to a readable contractor. */
  invitedFirm: { id: string; name: string | null } | null;
}

export interface RegistrationQueueRow {
  id: string;
  employeeId: string;
  fullName: string | null;
  /** fullName, or a Thai placeholder when the applicant hasn't filled it in yet. */
  displayName: string;
  status: RegistrationStatus;
  createdAt: string;
  docsUploadedCount: number;
  docsTotal: number;
  /** Mirrors the U1c approve RPC's floor exactly — see meetsApprovalFloor. */
  meetsFloor: boolean;
  /** Spec 322 — a pending row with this set was sent back for edit; the list
   *  gates the "ส่งกลับแก้ไข" chip on `status === 'pending' && hasReviewerNote`. */
  hasReviewerNote: boolean;
  /** Spec 328 U3 — firm chip label for a firm-invited row (null otherwise). */
  firmName: string | null;
}

const NO_NAME_PLACEHOLDER = "ยังไม่กรอกชื่อ-นามสกุล";
const UNRESOLVED_FIRM_LABEL = "ทีมผู้รับเหมา";

function isNonBlank(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

function countUploadedPurposes(uploaded: readonly StaffDocPurpose[]): number {
  const unique = new Set(uploaded.filter((p) => STAFF_DOC_PURPOSES.includes(p)));
  return unique.size;
}

export function buildRegistrationQueueRow(input: RegistrationQueueInput): RegistrationQueueRow {
  return {
    id: input.id,
    employeeId: input.employeeId,
    fullName: input.fullName,
    displayName: isNonBlank(input.fullName) ? input.fullName : NO_NAME_PLACEHOLDER,
    status: input.status,
    createdAt: input.createdAt,
    docsUploadedCount: countUploadedPurposes(input.uploadedPurposes),
    docsTotal: STAFF_DOC_PURPOSES.length,
    meetsFloor: meetsApprovalFloor(input),
    hasReviewerNote: input.hasReviewerNote,
    firmName: input.invitedFirm ? (input.invitedFirm.name ?? UNRESOLVED_FIRM_LABEL) : null,
  };
}

/**
 * Mirrors approve_staff_registration's floor: full_name present
 * (nullif(btrim(...)) — blank/whitespace-only counts as absent) AND a live
 * id_card attachment AND a live book_bank passbook photo AND a saved bank row
 * (spec 296). UI hint only; the RPC is still the authoritative gate.
 *
 * NOTE: the RPC floor ALSO requires a live PDPA consent record, which this queue
 * hint does NOT check (it has never been fed the consent state — a pre-spec-296
 * omission). So `meetsFloor` can read true for an applicant who still owes
 * consent; the detail page + the RPC remain authoritative. Feeding consent
 * presence here is a follow-up (see progress-tracker open questions).
 */
export function meetsApprovalFloor(input: RegistrationQueueInput): boolean {
  if (!isNonBlank(input.fullName) || !input.uploadedPurposes.includes("id_card")) return false;
  // Spec 328 U3 — a firm-invited applicant is bank-exempt: the approve RPC's
  // contractor arm (mig 075815) skips the book_bank + staff_registration_bank
  // floors (id_card + PDPA stay), so the hint mirrors that carve.
  if (input.invitedFirm) return true;
  return input.uploadedPurposes.includes("book_bank") && input.hasBank;
}
