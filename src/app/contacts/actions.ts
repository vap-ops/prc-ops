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
import { PM_ROLES } from "@/lib/auth/role-home";
import type { Database } from "@/lib/db/database.types";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { validateNotes } from "@/lib/notes/validate";

export type RecordActionResult = { ok: true } | { ok: false; error: string };

const PM_ONLY = "เฉพาะผู้จัดการโครงการเท่านั้น";
const GENERIC = "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const CONTACTS_PATH = "/contacts";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;
type PmGate = { ok: true; supabase: ServerClient; userId: string } | { ok: false; error: string };

async function pmSession(): Promise<PmGate> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { data: userRow } = await auth.supabase
    .from("users")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY };
  }
  return { ok: true, supabase: auth.supabase, userId: auth.user.id };
}

/** Trim; blank → null (a cleared text field). */
function norm(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validName(value: string, max: number): boolean {
  const t = value.trim();
  return t.length > 0 && t.length <= max;
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

  const { error } = await gate.supabase.from("clients").insert({
    name: input.name.trim(),
    contact_person: norm(input.contactPerson),
    phone: norm(input.phone),
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
  if (input.phone !== undefined) patch.phone = norm(input.phone);
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
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!validName(input.name, MASTER_NAME_MAX)) {
    return { ok: false, error: `ชื่อผู้ขายต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร` };
  }
  const noteRes = validateNotes(input.note ?? "");
  if (!noteRes.ok) return { ok: false, error: noteRes.error };

  const { error } = await gate.supabase.from("suppliers").insert({
    name: input.name.trim(),
    phone: norm(input.phone),
    note: noteRes.value,
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
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC };

  const patch: Database["public"]["Tables"]["suppliers"]["Update"] = {};
  if (input.name !== undefined) {
    if (!validName(input.name, MASTER_NAME_MAX)) {
      return { ok: false, error: `ชื่อผู้ขายต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร` };
    }
    patch.name = input.name.trim();
  }
  if (input.phone !== undefined) patch.phone = norm(input.phone);
  if (input.note !== undefined) {
    const noteRes = validateNotes(input.note);
    if (!noteRes.ok) return { ok: false, error: noteRes.error };
    patch.note = noteRes.value;
  }
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
}): Promise<RecordActionResult> {
  const gate = await pmSession();
  if (!gate.ok) return gate;
  if (!validName(input.name, MASTER_NAME_MAX)) {
    return { ok: false, error: `ชื่อผู้รับเหมาต้องไม่ว่างและไม่เกิน ${MASTER_NAME_MAX} ตัวอักษร` };
  }
  const noteRes = validateNotes(input.note ?? "");
  if (!noteRes.ok) return { ok: false, error: noteRes.error };

  const { error } = await gate.supabase.from("contractors").insert({
    name: input.name.trim(),
    phone: norm(input.phone),
    note: noteRes.value,
    created_by: gate.userId,
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
}): Promise<RecordActionResult> {
  const gate = await pmSession();
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
  if (input.phone !== undefined) patch.phone = norm(input.phone);
  if (input.note !== undefined) {
    const noteRes = validateNotes(input.note);
    if (!noteRes.ok) return { ok: false, error: noteRes.error };
    patch.note = noteRes.value;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await gate.supabase.from("contractors").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}
