import "server-only";

// Spec 131 U2c — a portal user reads their OWN contact documents on /portal. Unlike
// the PM page (service-role admin + signed URLs), the portal MUST go through the
// RLS-respecting session (ADR 0051 §5: external sessions never touch the admin
// client). The DB enforces ownership twice: the contact_attachments own-contractor
// SELECT policy scopes the rows, and the contact-docs storage SELECT policy scopes
// createSignedUrls — both keyed on current_user_contractor_id().

import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { PORTAL_DOC_PURPOSES, isPortalDocPurpose, type PortalDocPurpose } from "./document-types";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;

// Mirrors the PM signed-URL TTL (spec 03 window): long enough to load, short
// enough that a leaked URL has little value.
const SIGNED_URL_TTL_SECONDS = 120;

export interface OwnContractorDocuments {
  /** Signed URL of the latest upload per portal-uploadable purpose (own path only). */
  urls: Partial<Record<PortalDocPurpose, string>>;
  /** Every contact_doc_purpose present on the caller's own rows (for completeness,
   *  incl. PM-collected company_cert / vat_cert the portal user can read but not upload). */
  present: Set<string>;
}

export async function getOwnContractorDocuments(
  supabase: ServerClient,
): Promise<OwnContractorDocuments> {
  // RLS scopes these rows to the caller's own contractor (U2c SELECT policy).
  const { data } = await supabase
    .from("contact_attachments")
    .select("purpose, storage_path, created_at")
    .order("created_at", { ascending: false });

  const rows = data ?? [];
  const present = new Set<string>();
  // Newest-first → the first storage_path per portal purpose is the current one.
  const latestPath = new Map<PortalDocPurpose, string>();
  for (const r of rows) {
    present.add(r.purpose);
    if (isPortalDocPurpose(r.purpose) && r.storage_path && !latestPath.has(r.purpose)) {
      latestPath.set(r.purpose, r.storage_path);
    }
  }

  const urls: Partial<Record<PortalDocPurpose, string>> = {};
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
    for (const purpose of PORTAL_DOC_PURPOSES) {
      const p = latestPath.get(purpose);
      const u = p ? byPath.get(p) : undefined;
      if (u) urls[purpose] = u;
    }
  }

  return { urls, present };
}
