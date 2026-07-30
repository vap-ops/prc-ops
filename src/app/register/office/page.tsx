// Spec 286 U1 — the office-role self-onboard door. Spec 342 — now INVITE-ONLY:
// the door forwards ?by (inviter uuid) + ?role (advisory role key) and the
// workspace renders a gate screen when they are absent/invalid. The role in
// the URL never binds — the approver confirms at approval (D5).

import { RegisterFreshnessGate } from "@/components/features/chrome/register-freshness-gate";
import { ForeignSessionNotice } from "@/components/features/register/foreign-session-notice";
import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";
import { borrowedRegisterSession } from "@/lib/register/foreign-session";
import { registerReturnPath } from "@/lib/register/register-entry";
import { REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";

export const metadata = { title: REGISTER_OFFICE_HEADING };

export default async function RegisterOfficePage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; role?: string }>;
}) {
  const { by, role } = await searchParams;
  // Spec 376 U4 — the office door carries the SAME hazard as the field door: an
  // invite link opened on a shared/office phone (or forwarded and opened on the
  // inviter's own device) lands the invitee inside that live session, where the
  // invite gate passes and the fresh form is filled under the wrong identity.
  // Same interstitial, same one way forward — back to this door with ?by/?role.
  const borrowed = await borrowedRegisterSession();
  return (
    <>
      {/* Spec 339 U2 — see register/technician/page.tsx. Office workspace also
          redirects approved users (and gates un-invited ones) before render. */}
      <RegisterFreshnessGate />
      {borrowed ? (
        <ForeignSessionNotice
          displayName={borrowed.displayName}
          returnTo={registerReturnPath("office", { by, role })}
        />
      ) : (
        <StaffRegisterWorkspace variant="office" by={by} role={role} />
      )}
    </>
  );
}
