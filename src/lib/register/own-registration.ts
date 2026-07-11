import "server-only";

// Spec 263 U2 / spec 264 G1+G2 — an applicant reads their OWN registration +
// documents + PDPA consent. Like the DC portal (spec 131 U2c's
// getOwnContractorDocuments), this MUST go through the RLS-respecting session —
// an external/visitor-reachable surface never uses the admin client (ADR 0051
// §5). The DB enforces ownership: the staff_registrations own-row SELECT
// policy scopes the row, the contact-docs storage SELECT policy scopes
// createSignedUrls, and the staff_consents own-row policy scopes the consent
// read — all keyed on auth.uid().

import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { STAFF_DOC_PURPOSES, isStaffDocPurpose, type StaffDocPurpose } from "./document-types";
import type { Database } from "@/lib/db/database.types";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;
type RegistrationRow = Database["public"]["Tables"]["staff_registrations"]["Row"];

// Mirrors the portal signed-URL TTL (spec 03 window).
const SIGNED_URL_TTL_SECONDS = 120;

export interface OwnRegistrationDocuments {
  /** Signed URL of the latest upload per purpose (own path only). */
  urls: Partial<Record<StaffDocPurpose, string>>;
}

export async function getOwnTechnicianRegistration(
  supabase: ServerClient,
  uid: string,
): Promise<RegistrationRow | null> {
  // Filtered by the caller's own uid so a back-office reader (whose
  // "readable by back office" policy admits every row) can never ambiguously
  // match more than one row here — this helper is the APPLICANT's own-row read.
  // RLS's own-row policy scopes it further (user_id = auth.uid()).
  const { data } = await supabase
    .from("staff_registrations")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();
  return data ?? null;
}

export async function getOwnRegistrationDocuments(
  supabase: ServerClient,
  registrationId: string,
): Promise<OwnRegistrationDocuments> {
  // RLS scopes these rows to the caller's own registration.
  const { data } = await supabase
    .from("staff_registration_attachments")
    .select("purpose, storage_path, created_at, superseded_by")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: false });

  const rows = data ?? [];
  // Newest-first → the first storage_path per purpose is the current (live) one.
  const latestPath = new Map<StaffDocPurpose, string>();
  for (const r of rows) {
    if (isStaffDocPurpose(r.purpose) && r.storage_path && !latestPath.has(r.purpose)) {
      latestPath.set(r.purpose, r.storage_path);
    }
  }

  const urls: Partial<Record<StaffDocPurpose, string>> = {};
  const paths = [...latestPath.values()];
  if (paths.length > 0) {
    // Signed on the RLS session — the storage SELECT policy admits only own paths.
    const { data: signed } = await supabase.storage
      .from(CONTACT_DOCS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    const byPath = new Map<string, string>();
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl && !s.error) byPath.set(s.path, s.signedUrl);
    }
    for (const purpose of STAFF_DOC_PURPOSES) {
      const p = latestPath.get(purpose);
      const u = p ? byPath.get(p) : undefined;
      if (u) urls[purpose] = u;
    }
  }

  return { urls };
}

// Spec 264 G2 — the applicant's own live (non-revoked) PDPA consent record, if
// any. Feeds both the checkbox's recorded/not-yet state and the approval-floor
// checklist. RLS's own-row policy on staff_consents scopes this to the caller.
export async function getOwnStaffConsent(
  supabase: ServerClient,
  registrationId: string,
): Promise<{ consentedAt: string } | null> {
  const { data } = await supabase
    .from("staff_consents")
    .select("consented_at, revoked_at")
    .eq("registration_id", registrationId)
    .is("revoked_at", null)
    .order("consented_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { consentedAt: data.consented_at } : null;
}

// Spec 296 — the applicant's own declared bank fields. The zero-grant
// staff_registration_bank table is unreadable by `authenticated` directly (bank
// PII is walled from in-project site_admins, ADR 0079); the DEFINER
// get_own_staff_bank returns only the caller's own row (keyed on auth.uid()).
// Feeds the form prefill + the approval-floor `hasBankFields`.
export async function getOwnStaffBank(
  supabase: ServerClient,
): Promise<{ bankName: string; accountNumber: string; accountName: string } | null> {
  const { data } = await supabase.rpc("get_own_staff_bank");
  const row = Array.isArray(data) ? data[0] : null;
  return row
    ? {
        bankName: row.bank_name,
        accountNumber: row.bank_account_number,
        accountName: row.bank_account_name,
      }
    : null;
}
