// Spec 329 — client-side byte upload; the storage INSERT policy is the gate.
// Path = <row-id>/<sanitized name>; the same id then becomes the table row id
// (upload-expense-receipt precedent: bytes first, metadata action second).
import { createClient } from "@/lib/db/browser";
import { COMPANY_DOCS_BUCKET } from "@/lib/storage/buckets";

const NAME_MAX = 120;

// Supabase Storage object keys reject non-ASCII, so the key must be ASCII only.
// A \p{L} class keeps Thai/CJK/accented letters (only combining marks strip),
// which produced "Invalid key: …/หน-งส-อร-บรอง-2608.pdf" — feedback e6b48386.
// Restrict to ASCII, keep the extension separately so a fully-non-ASCII base
// still yields a usable "document.<ext>" rather than a bare ".<ext>".
export function sanitizeDocFilename(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < name.length - 1;
  const base = (hasExt ? name.slice(0, lastDot) : name)
    .replace(/[^A-Za-z0-9.\-_]+/g, "-")
    // Strip leading/trailing dashes AND dots so a dot-only name (".", "..")
    // can't become a bare "." / ".." path segment; interior dots survive.
    .replace(/^[-.]+|[-.]+$/g, "");
  const ext = hasExt ? name.slice(lastDot + 1).replace(/[^A-Za-z0-9]+/g, "") : "";
  const safeBase = base === "" ? "document" : base;
  const suffix = ext === "" ? "" : `.${ext}`;
  // Cap the base, never the extension — a truncated key must still end in .<ext>.
  return safeBase.slice(0, Math.max(1, NAME_MAX - suffix.length)) + suffix;
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
