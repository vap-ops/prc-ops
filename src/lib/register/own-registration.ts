import "server-only";

// Spec 263 U2 — an applicant reads their OWN registration + documents. Like the
// DC portal (spec 131 U2c's getOwnContractorDocuments), this MUST go through the
// RLS-respecting session — an external/visitor-reachable surface never uses the
// admin client (ADR 0051 §5). The DB enforces ownership twice: the
// technician_registrations own-row SELECT policy scopes the row, and the
// contact-docs storage SELECT policy scopes createSignedUrls — both keyed on
// auth.uid(). (Spec 264 G1: the substrate is renamed to staff_registrations —
// this stays the applicant's own-row read.)

import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import {
  TECHNICIAN_DOC_PURPOSES,
  isTechnicianDocPurpose,
  type TechnicianDocPurpose,
} from "./document-types";
import type { Database } from "@/lib/db/database.types";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;
type RegistrationRow = Database["public"]["Tables"]["staff_registrations"]["Row"];

// Mirrors the portal signed-URL TTL (spec 03 window).
const SIGNED_URL_TTL_SECONDS = 120;

export interface OwnRegistrationDocuments {
  /** Signed URL of the latest upload per purpose (own path only). */
  urls: Partial<Record<TechnicianDocPurpose, string>>;
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
  const latestPath = new Map<TechnicianDocPurpose, string>();
  for (const r of rows) {
    if (isTechnicianDocPurpose(r.purpose) && r.storage_path && !latestPath.has(r.purpose)) {
      latestPath.set(r.purpose, r.storage_path);
    }
  }

  const urls: Partial<Record<TechnicianDocPurpose, string>> = {};
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
    for (const purpose of TECHNICIAN_DOC_PURPOSES) {
      const p = latestPath.get(purpose);
      const u = p ? byPath.get(p) : undefined;
      if (u) urls[purpose] = u;
    }
  }

  return { urls };
}
