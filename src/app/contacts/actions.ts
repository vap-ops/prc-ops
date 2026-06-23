"use server";

// Spec 81 — contacts CRUD for /contacts (clients, suppliers, contractors).
// The page is requireRole(PM_ROLES)-gated; every action re-checks PM_ROLES then
// writes directly under the authenticated session. PM/super already hold the
// INSERT/UPDATE policy + column grants on all three tables, so no SECURITY
// DEFINER RPC is needed (the spec-80 project_members precedent). The explicit
// PM check is defense-in-depth and gives a real error — an RLS UPDATE whose
// USING fails affects 0 rows SILENTLY (spec-80 lesson), so trusting RLS alone
// would mask a forbidden edit as success.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES, BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import type { Database } from "@/lib/db/database.types";
import { Constants } from "@/lib/db/database.types";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { validateNotes } from "@/lib/notes/validate";
import {
  formatThaiPhone,
  formatThaiTaxId,
  isValidThaiPhone,
  isValidThaiTaxId,
} from "@/lib/contacts/thai-format";
import { isValidPhotoExt } from "@/lib/photos/path";
import {
  buildContactDocPath,
  isContactDocKind,
  isContactDocPurpose,
  isContractorDocPurpose,
  type ContactDocKind,
} from "@/lib/contacts/document-path";

const E = Constants.public.Enums;

export type RecordActionResult = { ok: true } | { ok: false; error: string };

const PM_ONLY = "เฉพาะผู้จัดการโครงการเท่านั้น";
const BACK_OFFICE_ONLY = "เฉพาะฝ่ายจัดซื้อหรือผู้จัดการเท่านั้น";
const GENERIC = "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const CONTACTS_PATH = "/contacts";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;
type PmGate = { ok: true; supabase: ServerClient; userId: string } | { ok: false; error: string };

// Gate an action to a role allowlist, returning the authenticated session.
// An RLS UPDATE whose USING fails affects 0 rows SILENTLY (spec-80 lesson), so
// this explicit check is defense-in-depth + a real error message.
async function roleSession(allowed: ReadonlyArray<string>, denyMsg: string): Promise<PmGate> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { data: userRow } = await auth.supabase
    .from("users")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!userRow || !allowed.includes(userRow.role)) {
    return { ok: false, error: denyMsg };
  }
  return { ok: true, supabase: auth.supabase, userId: auth.user.id };
}

const pmSession = () => roleSession(PM_ROLES, PM_ONLY);

// Spec 101: suppliers are back-office data (pm/super + procurement), matching
// the suppliers RLS write posture — procurement curates suppliers.
const backOfficeSession = () => roleSession(BACK_OFFICE_ROLES, BACK_OFFICE_ONLY);

/** Trim; blank → null (a cleared text field). */
function norm(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Spec 191: optional phone — blank → null; otherwise must be 10 digits (leading
// 0), stored canonical 0XX-XXX-XXXX. Server-side mirror of the form mask so a
// non-form caller / pasted value can't slip past.
function normPhone(value: string | undefined): { ok: true; value: string | null } | { ok: false } {
  const t = (value ?? "").trim();
  if (t.length === 0) return { ok: true, value: null };
  if (!isValidThaiPhone(t)) return { ok: false };
  return { ok: true, value: formatThaiPhone(t) };
}

// Spec 191: optional Thai tax id — blank → null; otherwise 13 digits, stored
// canonical X-XXXX-XXXXX-XX-X.
function normTaxId(value: string | undefined): { ok: true; value: string | null } | { ok: false } {
  const t = (value ?? "").trim();
  if (t.length === 0) return { ok: true, value: null };
  if (!isValidThaiTaxId(t)) return { ok: false };
  return { ok: true, value: formatThaiTaxId(t) };
}

const BAD_PHONE = "เบอร์โทรต้องเป็นตัวเลข 10 หลัก";
const BAD_TAX_ID = "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก";

function validName(value: string, max: number): boolean {
  const t = value.trim();
  return t.length > 0 && t.length <= max;
}

/** Narrow a string to an enum value. undefined input → undefined (omit/preserve). */
function checkEnum<T extends string>(
  allowed: readonly T[],
  v: string | undefined,
): { ok: true; value: T | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  return (allowed as readonly string[]).includes(v) ? { ok: true, value: v as T } : { ok: false };
}

// ── clients ────────────────────────────────────────────────────────────────

const CLIENT_NAME_MAX = 120;

export async function createClientRecord(input: {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  mailingAddress?: string;
  note?: string;
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!validName(input.name, CLIENT_NAME_MAX)) {
    return { ok: false, error: `ชื่อลูกค้าต้องไม่ว่างและไม่เกิน ${CLIENT_NAME_MAX} ตัวอักษร` };
  }
  const noteRes = validateNotes(input.note ?? "");
  if (!noteRes.ok) return { ok: false, error: noteRes.error };

  const phoneRes = normPhone(input.phone);
  if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };

  const { error } = await gate.supabase.from("clients").insert({
    name: input.name.trim(),
    contact_person: norm(input.contactPerson),
    phone: phoneRes.value,
    email: norm(input.email),
    mailing_address: norm(input.mailingAddress),
    note: noteRes.value,
    created_by: gate.userId,
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

export async function updateClientRecord(input: {
  id: string;
  name?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  mailingAddress?: string;
  note?: string;
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC };

  const patch: Database["public"]["Tables"]["clients"]["Update"] = {};
  if (input.name !== undefined) {
    if (!validName(input.name, CLIENT_NAME_MAX)) {
      return { ok: false, error: `ชื่อลูกค้าต้องไม่ว่างและไม่เกิน ${CLIENT_NAME_MAX} ตัวอักษร` };
    }
    patch.name = input.name.trim();
  }
  if (input.contactPerson !== undefined) patch.contact_person = norm(input.contactPerson);
  if (input.phone !== undefined) {
    const phoneRes = normPhone(input.phone);
    if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };
    patch.phone = phoneRes.value;
  }
  if (input.email !== undefined) patch.email = norm(input.email);
  if (input.mailingAddress !== undefined) patch.mailing_address = norm(input.mailingAddress);
  if (input.note !== undefined) {
    const noteRes = validateNotes(input.note);
    if (!noteRes.ok) return { ok: false, error: noteRes.error };
    patch.note = noteRes.value;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await gate.supabase.from("clients").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

// ── suppliers ────────────────────────────────────────────────────────────────

const MASTER_NAME_MAX = 200;

export async function createSupplierRecord(input: {
  name: string;
  phone?: string;
  note?: string;
  contactPerson?: string;
  email?: string;
  mailingAddress?: string;
  taxId?: string;
  paymentTerms?: string;
}): Promise<RecordActionResult> {
  const gate = await backOfficeSession();
  if (!gate.ok) return gate;
  if (!validName(input.name, MASTER_NAME_MAX)) {
    return { ok: false, error: `ชื่อผู้ขายต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร` };
  }
  const noteRes = validateNotes(input.note ?? "");
  if (!noteRes.ok) return { ok: false, error: noteRes.error };

  const phoneRes = normPhone(input.phone);
  if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };
  const taxRes = normTaxId(input.taxId);
  if (!taxRes.ok) return { ok: false, error: BAD_TAX_ID };

  const { error } = await gate.supabase.from("suppliers").insert({
    name: input.name.trim(),
    phone: phoneRes.value,
    note: noteRes.value,
    contact_person: norm(input.contactPerson),
    email: norm(input.email),
    mailing_address: norm(input.mailingAddress),
    tax_id: taxRes.value,
    payment_terms: norm(input.paymentTerms),
    created_by: gate.userId,
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

export async function updateSupplierRecord(input: {
  id: string;
  name?: string;
  phone?: string;
  note?: string;
  contactPerson?: string;
  email?: string;
  mailingAddress?: string;
  taxId?: string;
  paymentTerms?: string;
}): Promise<RecordActionResult> {
  const gate = await backOfficeSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC };

  const patch: Database["public"]["Tables"]["suppliers"]["Update"] = {};
  if (input.name !== undefined) {
    if (!validName(input.name, MASTER_NAME_MAX)) {
      return { ok: false, error: `ชื่อผู้ขายต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร` };
    }
    patch.name = input.name.trim();
  }
  if (input.phone !== undefined) {
    const phoneRes = normPhone(input.phone);
    if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };
    patch.phone = phoneRes.value;
  }
  if (input.note !== undefined) {
    const noteRes = validateNotes(input.note);
    if (!noteRes.ok) return { ok: false, error: noteRes.error };
    patch.note = noteRes.value;
  }
  if (input.contactPerson !== undefined) patch.contact_person = norm(input.contactPerson);
  if (input.email !== undefined) patch.email = norm(input.email);
  if (input.mailingAddress !== undefined) patch.mailing_address = norm(input.mailingAddress);
  if (input.taxId !== undefined) {
    const taxRes = normTaxId(input.taxId);
    if (!taxRes.ok) return { ok: false, error: BAD_TAX_ID };
    patch.tax_id = taxRes.value;
  }
  if (input.paymentTerms !== undefined) patch.payment_terms = norm(input.paymentTerms);
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await gate.supabase.from("suppliers").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

// ── contractors ──────────────────────────────────────────────────────────────

export async function createContractorRecord(input: {
  name: string;
  phone?: string;
  note?: string;
  contractorCategory?: string;
  contractorSubtype?: string;
  status?: string;
  contactPerson?: string;
  email?: string;
  mailingAddress?: string;
  taxId?: string;
  specialty?: string;
}): Promise<RecordActionResult> {
  // Spec 172 Phase B: procurement curates contractors (back-office, like suppliers).
  const gate = await backOfficeSession();
  if (!gate.ok) return gate;
  if (!validName(input.name, MASTER_NAME_MAX)) {
    return { ok: false, error: `ชื่อผู้รับเหมาต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร` };
  }
  const noteRes = validateNotes(input.note ?? "");
  if (!noteRes.ok) return { ok: false, error: noteRes.error };
  const cat = checkEnum(E.contractor_category, input.contractorCategory);
  const sub = checkEnum(E.contractor_subtype, input.contractorSubtype);
  const st = checkEnum(E.contact_status, input.status);
  if (!cat.ok || !sub.ok || !st.ok) return { ok: false, error: GENERIC };

  const phoneRes = normPhone(input.phone);
  if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };
  const taxRes = normTaxId(input.taxId);
  if (!taxRes.ok) return { ok: false, error: BAD_TAX_ID };

  const { error } = await gate.supabase.from("contractors").insert({
    name: input.name.trim(),
    phone: phoneRes.value,
    note: noteRes.value,
    contact_person: norm(input.contactPerson),
    email: norm(input.email),
    mailing_address: norm(input.mailingAddress),
    tax_id: taxRes.value,
    specialty: norm(input.specialty),
    created_by: gate.userId,
    ...(cat.value !== undefined ? { contractor_category: cat.value } : {}),
    ...(sub.value !== undefined ? { contractor_subtype: sub.value } : {}),
    ...(st.value !== undefined ? { status: st.value } : {}),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

export async function updateContractorRecord(input: {
  id: string;
  name?: string;
  phone?: string;
  note?: string;
  contractorCategory?: string;
  contractorSubtype?: string;
  status?: string;
  contactPerson?: string;
  email?: string;
  mailingAddress?: string;
  taxId?: string;
  specialty?: string;
}): Promise<RecordActionResult> {
  // Spec 172 Phase B: procurement curates contractors (back-office).
  const gate = await backOfficeSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC };

  const patch: Database["public"]["Tables"]["contractors"]["Update"] = {};
  if (input.name !== undefined) {
    if (!validName(input.name, MASTER_NAME_MAX)) {
      return {
        ok: false,
        error: `ชื่อผู้รับเหมาต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร`,
      };
    }
    patch.name = input.name.trim();
  }
  if (input.phone !== undefined) {
    const phoneRes = normPhone(input.phone);
    if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };
    patch.phone = phoneRes.value;
  }
  if (input.note !== undefined) {
    const noteRes = validateNotes(input.note);
    if (!noteRes.ok) return { ok: false, error: noteRes.error };
    patch.note = noteRes.value;
  }
  if (input.contactPerson !== undefined) patch.contact_person = norm(input.contactPerson);
  if (input.email !== undefined) patch.email = norm(input.email);
  if (input.mailingAddress !== undefined) patch.mailing_address = norm(input.mailingAddress);
  if (input.taxId !== undefined) {
    const taxRes = normTaxId(input.taxId);
    if (!taxRes.ok) return { ok: false, error: BAD_TAX_ID };
    patch.tax_id = taxRes.value;
  }
  if (input.specialty !== undefined) patch.specialty = norm(input.specialty);
  if (input.contractorCategory !== undefined) {
    const cat = checkEnum(E.contractor_category, input.contractorCategory);
    if (!cat.ok || cat.value === undefined) return { ok: false, error: GENERIC };
    patch.contractor_category = cat.value;
  }
  if (input.contractorSubtype !== undefined) {
    // "" clears the subtype to null; otherwise it must be a valid enum value.
    if (input.contractorSubtype === "") {
      patch.contractor_subtype = null;
    } else {
      const sub = checkEnum(E.contractor_subtype, input.contractorSubtype);
      if (!sub.ok || sub.value === undefined) return { ok: false, error: GENERIC };
      patch.contractor_subtype = sub.value;
    }
  }
  if (input.status !== undefined) {
    const st = checkEnum(E.contact_status, input.status);
    if (!st.ok || st.value === undefined) return { ok: false, error: GENERIC };
    patch.status = st.value;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await gate.supabase.from("contractors").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

// ── service_providers ────────────────────────────────────────────────────────

export async function createServiceProviderRecord(input: {
  name: string;
  serviceSubtype?: string;
  status?: string;
  phone?: string;
  contactPerson?: string;
  email?: string;
  mailingAddress?: string;
  vehicleType?: string;
  plateNo?: string;
  note?: string;
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!validName(input.name, MASTER_NAME_MAX)) {
    return {
      ok: false,
      error: `ชื่อผู้ให้บริการต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร`,
    };
  }
  const noteRes = validateNotes(input.note ?? "");
  if (!noteRes.ok) return { ok: false, error: noteRes.error };
  const sub = checkEnum(E.service_subtype, input.serviceSubtype);
  const st = checkEnum(E.contact_status, input.status);
  if (!sub.ok || !st.ok) return { ok: false, error: GENERIC };

  const phoneRes = normPhone(input.phone);
  if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };

  const { error } = await gate.supabase.from("service_providers").insert({
    name: input.name.trim(),
    phone: phoneRes.value,
    contact_person: norm(input.contactPerson),
    email: norm(input.email),
    mailing_address: norm(input.mailingAddress),
    vehicle_type: norm(input.vehicleType),
    plate_no: norm(input.plateNo),
    note: noteRes.value,
    created_by: gate.userId,
    ...(sub.value !== undefined ? { service_subtype: sub.value } : {}),
    ...(st.value !== undefined ? { status: st.value } : {}),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

export async function updateServiceProviderRecord(input: {
  id: string;
  name?: string;
  serviceSubtype?: string;
  status?: string;
  phone?: string;
  contactPerson?: string;
  email?: string;
  mailingAddress?: string;
  vehicleType?: string;
  plateNo?: string;
  note?: string;
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC };

  const patch: Database["public"]["Tables"]["service_providers"]["Update"] = {};
  if (input.name !== undefined) {
    if (!validName(input.name, MASTER_NAME_MAX)) {
      return {
        ok: false,
        error: `ชื่อผู้ให้บริการต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร`,
      };
    }
    patch.name = input.name.trim();
  }
  if (input.phone !== undefined) {
    const phoneRes = normPhone(input.phone);
    if (!phoneRes.ok) return { ok: false, error: BAD_PHONE };
    patch.phone = phoneRes.value;
  }
  if (input.contactPerson !== undefined) patch.contact_person = norm(input.contactPerson);
  if (input.email !== undefined) patch.email = norm(input.email);
  if (input.mailingAddress !== undefined) patch.mailing_address = norm(input.mailingAddress);
  if (input.vehicleType !== undefined) patch.vehicle_type = norm(input.vehicleType);
  if (input.plateNo !== undefined) patch.plate_no = norm(input.plateNo);
  if (input.note !== undefined) {
    const noteRes = validateNotes(input.note);
    if (!noteRes.ok) return { ok: false, error: noteRes.error };
    patch.note = noteRes.value;
  }
  if (input.serviceSubtype !== undefined) {
    const sub = checkEnum(E.service_subtype, input.serviceSubtype);
    if (!sub.ok || sub.value === undefined) return { ok: false, error: GENERIC };
    patch.service_subtype = sub.value;
  }
  if (input.status !== undefined) {
    const st = checkEnum(E.contact_status, input.status);
    if (!st.ok || st.value === undefined) return { ok: false, error: GENERIC };
    patch.status = st.value;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await gate.supabase.from("service_providers").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

// ── bank (money-isolated, spec 85) ───────────────────────────────────────────
// Written via the set_contact_bank SECURITY DEFINER RPC on the USER session
// (the RPC reads current_user_role()/auth.uid()); never the admin client.

export async function setContactBank(input: {
  kind: "contractor" | "supplier" | "service_provider";
  id: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
}): Promise<RecordActionResult> {
  // Spec 172 Phase B: procurement is the back-office payee-bank curator (the
  // set_contact_bank RPC gate now admits procurement too).
  const gate = await backOfficeSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC };

  const { error } = await gate.supabase.rpc("set_contact_bank", {
    ...(input.kind === "contractor" ? { p_contractor_id: input.id } : {}),
    ...(input.kind === "supplier" ? { p_supplier_id: input.id } : {}),
    ...(input.kind === "service_provider" ? { p_service_provider_id: input.id } : {}),
    ...(input.bankName !== undefined ? { p_bank_name: input.bankName } : {}),
    ...(input.bankAccountNo !== undefined ? { p_bank_account_no: input.bankAccountNo } : {}),
    ...(input.bankAccountName !== undefined ? { p_bank_account_name: input.bankAccountName } : {}),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

// ── documents (PII / bank-adjacent, spec 97) ─────────────────────────────────
// The file is uploaded client-side to the private contact-docs bucket; this
// action REBUILDS the storage path (never trusts the client's) and records the
// row via the add_contact_document SECURITY DEFINER RPC on the USER session.

const CONTACT_TYPE_SEGMENT: Record<ContactDocKind, string> = {
  contractor: "contractors",
  supplier: "suppliers",
  service_provider: "service-providers",
};

export async function addContactDocument(input: {
  kind: string;
  id: string;
  purpose: string;
  attachmentId: string;
  ext: string;
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!isContactDocKind(input.kind)) return { ok: false, error: GENERIC };
  // Spec 131 U3 — a contractor additionally accepts company papers (company_cert
  // / vat_cert); suppliers + service providers keep the base id_card/bank_book set.
  if (input.kind === "contractor") {
    if (!isContractorDocPurpose(input.purpose)) return { ok: false, error: GENERIC };
  } else {
    if (!isContactDocPurpose(input.purpose)) return { ok: false, error: GENERIC };
  }
  if (!UUID_REGEX.test(input.id) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: GENERIC };
  }
  if (!isValidPhotoExt(input.ext)) return { ok: false, error: GENERIC };

  const path = buildContactDocPath(input.kind, input.id, input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC };

  const { error } = await gate.supabase.rpc("add_contact_document", {
    ...(input.kind === "contractor" ? { p_contractor_id: input.id } : {}),
    ...(input.kind === "supplier" ? { p_supplier_id: input.id } : {}),
    ...(input.kind === "service_provider" ? { p_service_provider_id: input.id } : {}),
    p_purpose: input.purpose,
    p_storage_path: path,
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(`${CONTACTS_PATH}/${CONTACT_TYPE_SEGMENT[input.kind]}/${input.id}`);
  return { ok: true };
}

// ── consent (spec 131 — PDPA, money/PII-adjacent) ────────────────────────────
// Recorded/revoked via the record_/revoke_contractor_consent SECURITY DEFINER
// RPCs on the USER session (the RPCs gate on role/own-binding internally). PM
// records on a contractor's behalf after collecting the signed form.

const CONTRACTOR_PATH = (id: string) => `${CONTACTS_PATH}/contractors/${id}`;

export async function recordContractorConsent(input: {
  contractorId: string;
  kind: string;
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.contractorId)) return { ok: false, error: GENERIC };
  const kind = checkEnum(E.contractor_consent_kind, input.kind);
  if (!kind.ok || kind.value === undefined) return { ok: false, error: GENERIC };

  const { error } = await gate.supabase.rpc("record_contractor_consent", {
    p_contractor: input.contractorId,
    p_kind: kind.value,
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTRACTOR_PATH(input.contractorId));
  return { ok: true };
}

// ── portal invite (spec 130 U5) ──────────────────────────────────────────────
// A PM issues a single-use, 14-day claim link a DC opens to bind their LINE login
// to this contractor. create_contractor_invite (SECURITY DEFINER, pm/super)
// mints the token; the UI wraps it into the /portal/claim URL.

export type InviteResult = { ok: true; token: string } | { ok: false; error: string };

export async function createContractorInvite(input: {
  contractorId: string;
}): Promise<InviteResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.contractorId)) return { ok: false, error: GENERIC };

  const { data, error } = await gate.supabase.rpc("create_contractor_invite", {
    p_contractor_id: input.contractorId,
  });
  if (error || !data) return { ok: false, error: GENERIC };
  return { ok: true, token: data };
}

export async function revokeContractorConsent(input: {
  id: string;
  contractorId: string;
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.id) || !UUID_REGEX.test(input.contractorId)) {
    return { ok: false, error: GENERIC };
  }

  const { error } = await gate.supabase.rpc("revoke_contractor_consent", { p_id: input.id });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTRACTOR_PATH(input.contractorId));
  return { ok: true };
}
