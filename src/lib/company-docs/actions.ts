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

interface DocInput {
  id: string;
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
    title: input.title,
    note: input.note,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    storage_path: input.storagePath,
    superseded_by: supersedes,
    created_by: user.id,
  });
  if (error) return { ok: false, error: `บันทึกเอกสารไม่สำเร็จ: ${error.message}` };
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
  if (error) return { ok: false, error: `ถอนเอกสารไม่สำเร็จ: ${error.message}` };
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
