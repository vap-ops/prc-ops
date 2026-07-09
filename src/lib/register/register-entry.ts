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
  /** Where /login returns a logged-out visitor who tapped this door. */
  loginNext: string;
}

const COPY: Record<RegisterVariant, StaffRegisterCopy> = {
  field: {
    heading: REGISTER_FIELD_HEADING,
    path: REGISTER_FIELD_PATH,
    loginNext: `/login?next=${encodeURIComponent(REGISTER_FIELD_PATH)}`,
  },
  office: {
    heading: REGISTER_OFFICE_HEADING,
    path: REGISTER_OFFICE_PATH,
    loginNext: `/login?next=${encodeURIComponent(REGISTER_OFFICE_PATH)}`,
  },
};

export function staffRegisterCopy(variant: RegisterVariant): StaffRegisterCopy {
  return COPY[variant];
}

export interface VisitorRegisterEntry {
  path: string;
  label: string;
}

/** The self-serve doors offered to an organic visitor on /coming-soon, in
 * order: on-site first (the common case), office second. */
export const VISITOR_REGISTER_ENTRIES: readonly VisitorRegisterEntry[] = [
  { path: REGISTER_FIELD_PATH, label: REGISTER_FIELD_HEADING },
  { path: REGISTER_OFFICE_PATH, label: REGISTER_OFFICE_HEADING },
];
