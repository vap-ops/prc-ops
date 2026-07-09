// Spec 286 U1 — the office-role self-onboard door. Parity with the on-site
// (technician) door: the same role-neutral staff registration flow (form,
// documents, back-office queue, and the role-parametric approve_staff_registration
// RPC) — the approver assigns the office role at approval. No project-QR
// attribution: office roles are not project-scoped and get no `workers` row, so
// this door forwards no ?site/?project/?by. This URL is the office QR target.

import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";
import { REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";

export const metadata = { title: REGISTER_OFFICE_HEADING };

export default async function RegisterOfficePage() {
  return <StaffRegisterWorkspace variant="office" />;
}
