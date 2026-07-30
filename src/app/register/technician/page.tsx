// Spec 263 U2 / spec 264 G1+G2 — the on-site (technician) self-registration door.
// Spec 286 U1 — the workspace body now lives in the shared, variant-parameterized
// StaffRegisterWorkspace; this route supplies the "field" variant plus the spec
// 279 F2a/F2b QR attribution (?site display label, ?project/?by advisory) so the
// existing on-site QR links keep working unchanged.

import { RegisterFreshnessGate } from "@/components/features/chrome/register-freshness-gate";
import { ForeignSessionNotice } from "@/components/features/register/foreign-session-notice";
import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";
import { borrowedRegisterSession } from "@/lib/register/foreign-session";
import { registerReturnPath } from "@/lib/register/register-entry";
import { REGISTER_FIELD_HEADING } from "@/lib/i18n/labels";

export const metadata = { title: REGISTER_FIELD_HEADING };

export default async function RegisterTechnicianPage({
  searchParams,
}: {
  searchParams: Promise<{
    site?: string;
    project?: string;
    by?: string;
    // Spec 328 — the per-firm subcon QR (?contractor advisory uuid, ?firm display label).
    contractor?: string;
    firm?: string;
  }>;
}) {
  const { site, project, by, contractor, firm } = await searchParams;
  // Spec 376 U4 — the shared-phone door. Checked HERE, ahead of the workspace, so
  // it precedes the workspace's silent redirects (a borrowed `technician` session
  // was bounced into that person's home). The notice replaces the workspace
  // entirely; the freshness gate stays outside the branch — it belongs to the
  // ROUTE, and its wiring pin counts exactly one mount per register page.
  const borrowed = await borrowedRegisterSession();
  return (
    <>
      {/* Spec 339 U2 — a stale PWA on this pre-approval route reloads itself onto
          the current build. The workspace redirects approved users away first,
          so this only ever runs for an unapproved (visitor) applicant. */}
      <RegisterFreshnessGate />
      {borrowed ? (
        <ForeignSessionNotice
          displayName={borrowed.displayName}
          returnTo={registerReturnPath("field", { site, project, by, contractor, firm })}
        />
      ) : (
        <StaffRegisterWorkspace
          variant="field"
          site={site}
          project={project}
          by={by}
          contractor={contractor}
          firm={firm}
        />
      )}
    </>
  );
}
