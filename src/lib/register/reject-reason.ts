// Spec 263 U3 — pure validation for a reject reason. reject_technician_registration
// takes p_reason but does not itself require a non-blank value (it nullif/btrims
// it); the U3 brief requires the UI to demand one before the reviewer can submit
// a reject. Mirrors registration-profile.ts's shape (trim, length cap, Thai
// message) — no Supabase, no server-only, importable from a client component.

const MAX_LEN = 500;

export function validateRejectReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "กรุณาระบุเหตุผลที่ปฏิเสธ";
  if (trimmed.length > MAX_LEN) return "เหตุผลยาวเกินไป";
  return null;
}
