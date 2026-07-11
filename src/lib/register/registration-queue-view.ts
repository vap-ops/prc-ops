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
}

const NO_NAME_PLACEHOLDER = "ยังไม่กรอกชื่อ-นามสกุล";

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
  return (
    isNonBlank(input.fullName) &&
    input.uploadedPurposes.includes("id_card") &&
    input.uploadedPurposes.includes("book_bank") &&
    input.hasBank
  );
}
