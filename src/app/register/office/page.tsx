// Spec 286 U1 — the office-role self-onboard door. Spec 342 — now INVITE-ONLY:
// the door forwards ?by (inviter uuid) + ?role (advisory role key) and the
// workspace renders a gate screen when they are absent/invalid. The role in
// the URL never binds — the approver confirms at approval (D5).

import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";
import { REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";

export const metadata = { title: REGISTER_OFFICE_HEADING };

export default async function RegisterOfficePage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; role?: string }>;
}) {
  const { by, role } = await searchParams;
  return <StaffRegisterWorkspace variant="office" by={by} role={role} />;
}
