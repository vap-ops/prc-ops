// Spec 329 — client-side byte upload; the storage INSERT policy is the gate.
// Path = <row-id>/<sanitized name>; the same id then becomes the table row id
// (upload-expense-receipt precedent: bytes first, metadata action second).
import { createClient } from "@/lib/db/browser";
import { COMPANY_DOCS_BUCKET } from "@/lib/storage/buckets";

const NAME_MAX = 120;

export function sanitizeDocFilename(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}.\-_]+/gu, "-").replace(/^-+|-+$/g, "");
  return (cleaned === "" ? "document" : cleaned).slice(0, NAME_MAX);
}

export async function uploadCompanyDocFile(
  file: File,
): Promise<{ id: string; path: string } | { error: string }> {
  const id = crypto.randomUUID();
  const path = `${id}/${sanitizeDocFilename(file.name)}`;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(COMPANY_DOCS_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error !== null) return { error: `อัปโหลดไฟล์ไม่สำเร็จ: ${error.message}` };
  return { id, path };
}
