// Spec 263 U2 / spec 264 G1+G2 — the on-site (technician) self-registration door.
// Spec 286 U1 — the workspace body now lives in the shared, variant-parameterized
// StaffRegisterWorkspace; this route supplies the "field" variant plus the spec
// 279 F2a/F2b QR attribution (?site display label, ?project/?by advisory) so the
// existing on-site QR links keep working unchanged.

import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";
import { REGISTER_FIELD_HEADING } from "@/lib/i18n/labels";

export const metadata = { title: REGISTER_FIELD_HEADING };

export default async function RegisterTechnicianPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; project?: string; by?: string }>;
}) {
  const { site, project, by } = await searchParams;
  return <StaffRegisterWorkspace variant="field" site={site} project={project} by={by} />;
}
