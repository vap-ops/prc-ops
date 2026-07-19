"use server";
// Spec 329 — metadata writes (table RLS gates again server-side) + share link.
// Bytes are uploaded client-side (upload-company-doc.ts); these actions only
// record rows / mint URLs. Supersede-pattern skill applies: INSERTs only.
import { requireActionRole } from "@/lib/auth/action-gate";
import { ACCOUNTING_ROLES, COMPANY_DOC_VIEW_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { COMPANY_DOCS_BUCKET } from "@/lib/storage/buckets";
import { revalidatePath } from "next/cache";

const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PAGE_PATH = "/settings/company-docs";

// The partial UNIQUE index on superseded_by rejects a write against a stale
// head (someone else already versioned/retired it) as 23505 — map it to a
// refresh hint instead of a raw constraint message.
const STALE_HEAD_MESSAGE = "เอกสารนี้ถูกแก้ไขไปแล้ว กรุณารีเฟรชหน้าแล้วลองใหม่";

function insertErrorMessage(prefix: string, error: { code?: string; message: string }): string {
  if (error.code === "23505") return STALE_HEAD_MESSAGE;
  // Spec 331: the enforce-type trigger raises P0001 with a message already
  // written for the user (e.g. "มีเอกสารประเภทนี้อยู่แล้ว ใช้ปุ่มเวอร์ชันใหม่แทน") —
  // surface it as-is instead of burying it behind a generic prefix.
  if (error.code === "P0001") return error.message;
  return `${prefix}: ${error.message}`;
}

interface DocInput {
  id: string;
  // Spec 331: the document's IDENTITY. `title` is now a derived display
  // snapshot (the type's name + label) — the DB refuses a content row without
  // a known, active type.
  typeId: string;
  label: string | null;
  title: string;
  note: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  storagePath: string;
}

type ActionResult = { ok: true } | { ok: false; error: string };

async function insertDocument(input: DocInput, supersedes: string | null): Promise<ActionResult> {
  const gate = await requireActionRole(ACCOUNTING_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };
  const { supabase, user } = gate.auth;
  const { error } = await supabase.from("company_documents").insert({
    id: input.id,
    type_id: input.typeId,
    label: input.label,
    title: input.title,
    note: input.note,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    storage_path: input.storagePath,
    superseded_by: supersedes,
    created_by: user.id,
  });
  if (error) return { ok: false, error: insertErrorMessage("บันทึกเอกสารไม่สำเร็จ", error) };
  revalidatePath(PAGE_PATH);
  return { ok: true };
}

export async function addCompanyDocument(input: DocInput): Promise<ActionResult> {
  return insertDocument(input, null);
}

export async function addCompanyDocumentVersion(
  input: DocInput & { supersedes: string },
): Promise<ActionResult> {
  return insertDocument(input, input.supersedes);
}

export async function retireCompanyDocument(input: { headId: string }): Promise<ActionResult> {
  const gate = await requireActionRole(ACCOUNTING_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };
  const { supabase, user } = gate.auth;
  const { error } = await supabase.from("company_documents").insert({
    superseded_by: input.headId,
    created_by: user.id,
  });
  if (error) return { ok: false, error: insertErrorMessage("ถอนเอกสารไม่สำเร็จ", error) };
  revalidatePath(PAGE_PATH);
  return { ok: true };
}

export async function mintCompanyDocShareLink(input: {
  storagePath: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const gate = await requireActionRole(COMPANY_DOC_VIEW_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };
  const { data, error } = await createAdminClient()
    .storage.from(COMPANY_DOCS_BUCKET)
    .createSignedUrl(input.storagePath, SHARE_TTL_SECONDS);
  if (error !== null || data === null) {
    return { ok: false, error: "สร้างลิงก์ไม่สำเร็จ กรุณาลองใหม่" };
  }
  return { ok: true, url: data.signedUrl };
}
