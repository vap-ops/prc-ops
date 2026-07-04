// Spec 263 U3 — pure view-model for the back-office approval queue row. Pure
// (no Supabase, no server-only — same discipline as card-view.ts /
// document-types.ts): the data layer reads the raw rows + attachment purposes,
// this module shapes them for the list. `meetsApprovalFloor` mirrors the U1c
// `approve_technician_registration` RPC's completeness floor EXACTLY (full_name
// present AND a live id_card attachment) so the queue can flag an incomplete
// applicant before the reviewer opens the detail and hits the RPC's floor
// rejection — UI hint only, the RPC remains the authoritative gate.

import type { Database } from "@/lib/db/database.types";
import { TECHNICIAN_DOC_PURPOSES, type TechnicianDocPurpose } from "./document-types";

type RegistrationStatus = Database["public"]["Enums"]["registration_status"];

export interface RegistrationQueueInput {
  id: string;
  employeeId: string;
  fullName: string | null;
  status: RegistrationStatus;
  createdAt: string;
  /** The live (current, supersede-head) attachment purposes on this registration. */
  uploadedPurposes: readonly TechnicianDocPurpose[];
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

function countUploadedPurposes(uploaded: readonly TechnicianDocPurpose[]): number {
  const unique = new Set(uploaded.filter((p) => TECHNICIAN_DOC_PURPOSES.includes(p)));
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
    docsTotal: TECHNICIAN_DOC_PURPOSES.length,
    meetsFloor: meetsApprovalFloor(input),
  };
}

/**
 * Mirrors approve_technician_registration's floor exactly: full_name present
 * (nullif(btrim(...)) — blank/whitespace-only counts as absent) AND a live
 * id_card attachment. UI hint only; the RPC is still the authoritative gate.
 */
export function meetsApprovalFloor(input: RegistrationQueueInput): boolean {
  return isNonBlank(input.fullName) && input.uploadedPurposes.includes("id_card");
}
