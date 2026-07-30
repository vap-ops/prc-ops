import "server-only";

// Spec 376 U4 (§3.3, D5) — "is this register door being opened inside SOMEONE
// ELSE's session?", answered once for both doors (/register/technician and
// /register/office render the same interstitial).
//
// The read mirrors StaffRegisterWorkspace's own auth read exactly — getClaims()
// (local JWT verify against the cached JWKS, ADR 0021: no Auth round-trip on the
// render path) then the caller's own `users` row on the RLS session. It runs
// BEFORE the workspace so it precedes the workspace's silent redirects, which are
// half of the reported symptom: a borrowed `technician` session was bounced into
// that person's home with no explanation at all.

import { roleHome } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import {
  getOwnRegistrationDocuments,
  getOwnStaffBank,
  getOwnTechnicianRegistration,
} from "@/lib/register/own-registration";
import { deferredDocsOwed } from "@/lib/register/docs-owed";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";
import type { Database } from "@/lib/db/database.types";

// Local alias, as in docs-owed.ts / card-view.ts (the register lib's convention).
type RegistrationStatus = Database["public"]["Enums"]["registration_status"];
type RegistrationRow = Database["public"]["Tables"]["staff_registrations"]["Row"];
type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface OwnRegistrationState {
  status: RegistrationStatus;
  /** `staff_registrations.documents_deferred_at` (spec 333 U2). */
  documentsDeferredAt: string | null;
  /** `deferredDocsOwed(...).length > 0` — computed by the caller with the same
   * helper and the same document/bank reads the workspace uses. Only consulted
   * for an approved+deferred row. */
  deferredDocsOwed: boolean;
}

/** Does this door RENDER anything for the caller's own registration row? That —
 * not the role — is what makes the session belong to the person standing there.
 *
 * Stated as what StaffRegisterWorkspace actually DOES, which is not the same as
 * what the row is: `pending`/`rejected` get the status view + edit form, and an
 * `approved` row is redirected home in every case EXCEPT a deferred approval with
 * something still owed (the spec-333 U2 docs-owed view, gated on
 * `deferredDocsOwed(...).length > 0`, not on the stamp).
 *
 * The owed condition is load-bearing, not defensive: nothing in `src/` or the
 * migrations ever clears `documents_deferred_at`, so treating the bare stamp as
 * "served" would suppress the notice FOREVER for every deferred hire who finished
 * their documents — while the door silently redirects them, which is the exact
 * symptom U4 exists to remove. */
export function servesOwnRegistration(registration: OwnRegistrationState | null): boolean {
  if (!registration) return false;
  if (registration.status !== "approved") return true;
  return registration.documentsDeferredAt !== null && registration.deferredDocsOwed;
}

export interface RegisterSessionIdentity {
  /** The signed-in user's role (`public.users.role`). */
  role: UserRole;
  /** Whether the caller holds an own registration THIS DOOR STILL SERVES
   * (servesOwnRegistration). A role-only rule was refuted by live data: two
   * `legal` users' one remaining step is on this page, and the deferred-docs view
   * is served to approved office roles — both would have been locked out. */
  hasOwnRegistration: boolean;
}

/** Foreign ⇔ a session exists AND this door renders nothing that belongs to its
 * owner. Exhaustive over the live `user_role` domain in BOTH directions:
 *
 *   - `visitor` — always the would-be registrant; the door serves them the form.
 *   - `technician` — always borrowed: StaffRegisterWorkspace redirects that role
 *     home BEFORE it ever reads a registration, so no row can make the door serve
 *     them, and that silent bounce is U4's headline symptom. (Paired pin:
 *     staff-register-workspace-prep.test.tsx holds the workspace's own redirect.)
 *   - everything else — borrowed unless the door still serves their own row.
 *
 * A new enum value classifies as foreign-when-unregistered — and reds the domain
 * pin, which is where that call gets made. */
export function isForeignSession({ role, hasOwnRegistration }: RegisterSessionIdentity): boolean {
  if (role === "visitor") return false;
  if (role === "technician") return true;
  return !hasOwnRegistration;
}

export interface BorrowedRegisterSession {
  /** Whose session this is. Never blank: the app name, else the LINE-owned name,
   * else the role label — a screen that asks "is this you?" must name something. */
  displayName: string;
  /** `roleHome(role)` for that session — the interstitial's SECONDARY way out.
   *
   * Load-bearing, because "borrowed" is a conservative classification, not a
   * proven one: `technician` is foreign by ROLE (the workspace bounces it home
   * before it reads any row), so all 13 live ช่าง re-scanning the site poster on
   * their OWN phone land here, as does the site admin who printed it. For them
   * logout is a closed loop — it returns to this same door, and signing back in
   * with the same LINE identity lands here again — and the page renders no
   * bottom bar and no hub strip to break it.
   *
   * Resolved HERE because this is where the role is already in hand; the doors
   * pass it straight through, so neither of them re-reads the session or
   * re-derives a landing. */
  homeHref: string;
}

/** The signed-in identity when a register door is being opened inside someone
 * else's session; `null` when the door belongs to whoever is holding the phone
 * (no session at all — the workspace owns that login redirect — or a visitor). */
export async function borrowedRegisterSession(): Promise<BorrowedRegisterSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;

  const uid = data.claims.sub;
  const { data: row } = await supabase
    .from("users")
    .select("role, full_name, line_display_name")
    .eq("id", uid)
    .maybeSingle();
  if (!row) return null;

  // The own-row read the workspace also makes (RLS own-row policy, spec 263 G1).
  // Deliberately unconditional: deriving hasOwnRegistration only for some roles
  // would put a second copy of the rule in the caller.
  const registration = await getOwnTechnicianRegistration(supabase, uid);
  const hasOwnRegistration = servesOwnRegistration(
    registration
      ? {
          status: registration.status,
          documentsDeferredAt: registration.documents_deferred_at,
          deferredDocsOwed: await stillOwesDeferredDocs(supabase, registration),
        }
      : null,
  );
  if (!isForeignSession({ role: row.role, hasOwnRegistration })) return null;

  return {
    displayName: row.full_name ?? row.line_display_name ?? USER_ROLE_LABEL[row.role],
    homeHref: roleHome(row.role),
  };
}

/** `deferredDocsOwed(...)` on the caller's own row — the SAME helper and the same
 * inputs StaffRegisterWorkspace feeds it, so the two can only ever agree. The
 * document/bank reads happen ONLY for an approved+deferred row (every other row's
 * served-ness is decided without them), which is why they are not hoisted. */
async function stillOwesDeferredDocs(
  supabase: ServerClient,
  registration: RegistrationRow,
): Promise<boolean> {
  if (registration.status !== "approved" || registration.documents_deferred_at === null) {
    return false;
  }
  const [{ urls }, bank] = await Promise.all([
    getOwnRegistrationDocuments(supabase, registration.id),
    getOwnStaffBank(supabase),
  ]);
  return (
    deferredDocsOwed({
      status: registration.status,
      documentsDeferredAt: registration.documents_deferred_at,
      hasIdCard: Boolean(urls.id_card),
      hasBookBank: Boolean(urls.book_bank),
      hasBankFields: bank !== null,
    }).length > 0
  );
}
