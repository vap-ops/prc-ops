// Spec 286 U1 — the office-role self-onboard door. The staff self-registration
// flow (form, documents, back-office queue, and the role-parametric
// approve_staff_registration RPC) is already role-neutral (spec 263/264); only
// the FRONT DOOR was technician-branded. This pure module is the single source
// for the two entry variants so the two thin route pages, the shared workspace,
// and the /coming-soon visitor landing all agree on copy + paths.
//
// Pure (no server-only, no Supabase client) — importable from the route pages,
// the shared workspace Server Component, and the client-free VisitorLanding.

import { REGISTER_FIELD_HEADING, REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";
import { REGISTER_WORKSPACE_PATH } from "@/lib/auth/visitor-router";
import { safeNextPath } from "@/lib/auth/next-path";
import { isValidUuid } from "@/lib/validate/uuid";
import { invitedRoleFromHint } from "@/lib/register/office-roles";
import type { UserRole } from "@/lib/auth/role-home";

/** Which self-onboard door the applicant entered. Label-only (spec 286): the
 * two variants share one form, one document set, one queue, and one approval
 * RPC — they differ only in the entry heading + URL. */
export type RegisterVariant = "field" | "office";

/** The on-site (technician) door. MUST equal REGISTER_WORKSPACE_PATH: a
 * registered visitor is redirected there post-submit by comingSoonDecision. */
export const REGISTER_FIELD_PATH = REGISTER_WORKSPACE_PATH;
export const REGISTER_OFFICE_PATH = "/register/office";

export interface StaffRegisterCopy {
  /** The h1 shown on the fresh registration form for this door. */
  heading: string;
  /** The route path for this door (also the metadata title source). */
  path: string;
}

const COPY: Record<RegisterVariant, StaffRegisterCopy> = {
  field: {
    heading: REGISTER_FIELD_HEADING,
    path: REGISTER_FIELD_PATH,
  },
  office: {
    heading: REGISTER_OFFICE_HEADING,
    path: REGISTER_OFFICE_PATH,
  },
};

export function staffRegisterCopy(variant: RegisterVariant): StaffRegisterCopy {
  return COPY[variant];
}

/** The QR attribution params a register door may carry (spec 279 F2a/F2b +
 * spec 328) — the same names technicianOnboardUrl mints. `project`/`by`/
 * `contractor` are uuid bindings; `site`/`firm` are display labels. */
export interface RegisterQrParams {
  project?: string | undefined;
  site?: string | undefined;
  by?: string | undefined;
  contractor?: string | undefined;
  firm?: string | undefined;
  /** Spec 342 — the office invite's role KEY (advisory, D5). */
  role?: string | undefined;
}

/** Where /login returns a logged-out visitor who tapped this door.
 *
 * A brand-new worker is ALWAYS logged out at first scan, so the QR's
 * attribution params must survive the LINE login round-trip — a static path
 * here silently orphaned every real registration (0 of 18 live rows ever
 * carried attribution). The produced `next` must pass safeNextPath at every
 * hop (/login → /auth/line/start → callback). URLSearchParams percent-encodes
 * label content, so the only label content the guard rejects is a literal
 * slash/backslash (%2F/%5C); such a label drops ALL labels in favor of keeping
 * the uuid bindings, and the no-params output stays byte-identical to the
 * historical static path. */
export function registerLoginNext(variant: RegisterVariant, params?: RegisterQrParams): string {
  const path = COPY[variant].path;
  const bindings = new URLSearchParams();
  for (const key of ["project", "by", "contractor"] as const) {
    const value = params?.[key];
    if (isValidUuid(value)) bindings.set(key, value);
  }
  const role = invitedRoleFromHint(params?.role);
  if (role) bindings.set("role", role);
  const full = new URLSearchParams(bindings);
  for (const key of ["site", "firm"] as const) {
    const value = params?.[key];
    if (value) full.set(key, value);
  }
  for (const candidate of [full, bindings]) {
    const qs = candidate.toString();
    if (!qs) continue;
    const next = safeNextPath(`${path}?${qs}`);
    if (next) return `/login?next=${encodeURIComponent(next)}`;
  }
  return `/login?next=${encodeURIComponent(path)}`;
}

/** Spec 342 U2.1 — a valid office invite = a uuid-shaped `by` AND an
 * onboardable `role`, both from the URL. UX gate only (D4): the uuid is not
 * verified to belong to a real inviter — anyone past this gate is merely an
 * applicant, and every approval floor sits downstream. */
export interface OfficeInvite {
  by: string;
  role: UserRole;
}

export function officeInviteParams(params: {
  by?: string | undefined;
  role?: string | undefined;
}): OfficeInvite | null {
  const role = invitedRoleFromHint(params.role);
  if (!isValidUuid(params.by) || !role) return null;
  return { by: params.by, role };
}

export interface VisitorRegisterEntry {
  path: string;
  label: string;
}

/** The self-serve doors offered to an organic visitor on /coming-soon. Spec
 * 342 D3: office is INVITE-ONLY now — only the on-site door remains open;
 * VisitorLanding renders the ask-for-a-link line in the office door's place. */
export const VISITOR_REGISTER_ENTRIES: readonly VisitorRegisterEntry[] = [
  { path: REGISTER_FIELD_PATH, label: REGISTER_FIELD_HEADING },
];
