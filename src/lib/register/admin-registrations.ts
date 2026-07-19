import "server-only";

// Spec 263 U3 — back-office reads of technician_registrations. Table rows are
// read on the caller's own RLS session (never the admin client): the
// can_see_technician_registration RLS policy already scopes SELECT correctly —
// the back-office approver set (procurement_manager/project_director/
// super_admin) sees every registration, SA/site_owner see only the pending
// queue (migration 20260813071300) — so a first-party authenticated reviewer
// never needs RLS bypassed here. The ONE thing that does need the service-role
// admin client is the document signed URLs: the contact-docs storage SELECT
// policy binds reads to `technician/<auth.uid()>/...` (the APPLICANT's own uid
// only), so a back-office reader's own session can never sign another
// applicant's doc paths — mintSignedUrls's service-role bypass is required
// there (ADR 0015/0026/0028 exposure-radius doctrine: the row-level RLS the
// caller already passed is the authorization; the admin client only mints the
// URL for a path already known to belong to a row the caller may see).

import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { STAFF_DOC_PURPOSES, isStaffDocPurpose } from "./document-types";
import type { Database } from "@/lib/db/database.types";
import type { RegistrationQueueInput } from "./registration-queue-view";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;
type RegistrationRow = Database["public"]["Tables"]["staff_registrations"]["Row"];
type AttachmentRow = Pick<
  Database["public"]["Tables"]["staff_registration_attachments"]["Row"],
  "id" | "purpose" | "storage_path" | "created_at" | "superseded_by"
>;

export interface RegistrationDocumentUrls {
  /** Signed URL of the latest (supersede-head) upload per purpose. */
  urls: Partial<Record<(typeof STAFF_DOC_PURPOSES)[number], string>>;
}

/**
 * Every registration this caller may see (RLS: back-office = all statuses,
 * SA/site_owner = pending only), newest-first. Statuses are not narrowed here —
 * callers filter/tab client- or server-side (spec doc allows "a reviewed/
 * rejected filter is fine").
 */
export async function listVisibleTechnicianRegistrations(
  supabase: ServerClient,
): Promise<RegistrationRow[]> {
  const { data } = await supabase
    .from("staff_registrations")
    .select("*")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Spec 328 U3 — resolve firm names for the queue's invited-firm chips. RLS-scoped
 * read: contractors are readable by the whole approver/queue audience
 * ("contractors readable by privileged roles" — site_admin, PM, PD,
 * procurement, procurement_manager, super_admin). An id that no longer
 * resolves simply stays absent (the view-model falls back to a generic label).
 */
export async function listContractorNames(
  supabase: ServerClient,
  contractorIds: readonly string[],
): Promise<Map<string, string>> {
  if (contractorIds.length === 0) return new Map();
  const { data } = await supabase
    .from("contractors")
    .select("id, name")
    .in("id", contractorIds as string[]);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

export async function getTechnicianRegistrationById(
  supabase: ServerClient,
  id: string,
): Promise<RegistrationRow | null> {
  const { data } = await supabase
    .from("staff_registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/**
 * The live (supersede-head) attachment purposes for a set of registrations —
 * the queue's doc-completeness hint input. RLS-scoped (can_see_technician_registration).
 * "Live" = ADR 0009 anti-join (no other row's superseded_by points at this
 * row's id), never `superseded_by IS NULL` on this row itself.
 */
export async function listLiveAttachmentPurposes(
  supabase: ServerClient,
  registrationIds: readonly string[],
): Promise<Map<string, RegistrationQueueInput["uploadedPurposes"]>> {
  const byRegistration = new Map<string, RegistrationQueueInput["uploadedPurposes"][number][]>();
  if (registrationIds.length === 0) return byRegistration;

  const { data } = await supabase
    .from("staff_registration_attachments")
    .select("id, registration_id, purpose, superseded_by")
    .in("registration_id", registrationIds as string[]);

  const rows = data ?? [];
  const supersededIds = new Set(rows.map((r) => r.superseded_by).filter((v): v is string => !!v));
  for (const row of rows) {
    if (supersededIds.has(row.id)) continue; // a newer row supersedes this one — not live.
    if (!isStaffDocPurpose(row.purpose)) continue;
    const list = byRegistration.get(row.registration_id) ?? [];
    list.push(row.purpose);
    byRegistration.set(row.registration_id, list);
  }
  return byRegistration;
}

/**
 * Signed URLs for one registration's documents (id_card/consent/profile_photo,
 * latest per purpose). Reads the attachment rows on the RLS session (scoped by
 * can_see_technician_registration), then mints the storage signed URLs via the
 * service-role admin client (mintSignedUrls — the storage SELECT policy is
 * applicant-own-uid only, so a back-office reader's own session cannot sign
 * another applicant's paths).
 */
export async function getRegistrationDocumentUrls(
  supabase: ServerClient,
  registrationId: string,
): Promise<RegistrationDocumentUrls> {
  const { data } = await supabase
    .from("staff_registration_attachments")
    .select("id, purpose, storage_path, created_at, superseded_by")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: false });

  const rows: AttachmentRow[] = data ?? [];
  const latest = new Map<(typeof STAFF_DOC_PURPOSES)[number], AttachmentRow>();
  for (const row of rows) {
    if (isStaffDocPurpose(row.purpose) && row.storage_path && !latest.has(row.purpose)) {
      latest.set(row.purpose, row);
    }
  }

  const signable = [...latest.values()]
    .filter((r): r is AttachmentRow & { storage_path: string } => r.storage_path !== null)
    .map((r) => ({ id: r.id, storage_path: r.storage_path }));

  const urls: RegistrationDocumentUrls["urls"] = {};
  if (signable.length > 0) {
    const signedById = await mintSignedUrls(CONTACT_DOCS_BUCKET, signable);
    for (const purpose of STAFF_DOC_PURPOSES) {
      const row = latest.get(purpose);
      const u = row ? signedById.get(row.id) : undefined;
      if (u) urls[purpose] = u;
    }
  }

  return { urls };
}
