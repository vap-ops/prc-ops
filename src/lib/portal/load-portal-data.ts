// Spec 147 U4 — DC-portal data loader. The page formerly ran its reads in a
// serial waterfall (profile → consents → crew → payments → pending bank change →
// own-docs → bank-present). Every read is RLS-scoped to the calling contractor
// and independent, so they batch into one Promise.all → dependent tail (own-docs
// is only read once we know the profile exists). Behavior-preserving: same
// queries, same column lists, same results — only the scheduling changes. Mirrors
// the U1–U3 loaders. Concurrency is locked by tests/unit/load-portal-data.test.ts.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { getOwnContractorDocuments } from "@/lib/portal/own-documents";

type Db = SupabaseClient<Database>;

export async function loadPortalData(supabase: Db) {
  // The fan: six independent reads, each scoped to the caller's own contractor —
  // five via the U2 RLS policies, plus crew via get_my_crew_assignments (a definer
  // RPC scoped by the same binding, spec 160 U3).
  const [
    { data: profile },
    { data: consentRows },
    { data: crew },
    { data: payments },
    { data: pendingChange },
    { data: bankPresent },
  ] = await Promise.all([
    supabase
      .from("contractors")
      .select(
        "id, name, phone, tax_id, contact_person, email, mailing_address, specialty, contractor_subtype, emergency_contact_name, emergency_contact_relation, emergency_contact_phone, date_of_birth",
      )
      .maybeSingle(),
    supabase
      .from("contractor_consents")
      .select("id, kind, consented_at, revoked_at")
      .order("created_at", { ascending: false }),
    // Spec 160 U3: crew now carries each member's current project (definer RPC,
    // scoped to the caller's own crew; resolves the project name past projects RLS).
    supabase.rpc("get_my_crew_assignments"),
    supabase.rpc("get_my_wage_payments"),
    supabase
      .from("contractor_bank_change_requests")
      .select("id")
      .eq("status", "pending")
      .maybeSingle(),
    supabase.rpc("my_contact_bank_present"),
  ]);

  // Dependent tail: own documents (RLS-scoped read + signed URLs) only when a
  // profile row exists.
  const docs = profile?.id ? await getOwnContractorDocuments(supabase) : null;

  return { profile, consentRows, crew, payments, pendingChange, bankPresent, docs };
}
