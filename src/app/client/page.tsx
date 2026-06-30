import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";

export const metadata = { title: "ความคืบหน้าโครงการ" };

// Spec 233 / ADR 0067 — U1 stub. Gated to the `client` role (a non-client is
// routed home via roleHome). Until U2 supplies client_has_live_access and U4
// supplies the dedicated read-only render, every client is forwarded to the
// access-ended notice — safe-by-default: no progress data can leak before the
// live-access check and the dedicated readers exist.
export default async function ClientPortalPage() {
  await requireRole(["client"]);
  redirect("/client/access-ended");
}
