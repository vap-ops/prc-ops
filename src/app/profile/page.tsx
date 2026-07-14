import { PageShell } from "@/components/features/chrome/page-shell";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/common/avatar-surface";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { DisplayNameForm } from "@/components/features/common/display-name-form";
import { EmployeeIdCard } from "@/components/features/profile/employee-id-card";
import { WorkerBadgeQr } from "@/components/features/common/worker-badge-qr";
import { isEmployeeRole } from "@/lib/auth/role-home";
import { loadProfileCard } from "@/lib/profile/load-profile-card";
import { toWorkerBadgeQrSvg } from "@/lib/muster/badge-qr";
import { createClient } from "@/lib/db/server";
import { NotificationReadinessBanner } from "@/components/features/notifications/readiness-banner";
import { readinessFromUserRow } from "@/lib/notifications/readiness";

// Universal profile route — reachable by EVERY authenticated role, including
// visitor. Spec 07 / extends spec 05 / ADR 0017.
//
// Auth pattern mirrors /coming-soon (do NOT use requireRole — that would bounce
// unserved roles to their roleHome, which is /coming-soon for visitor and
// defeats the unit's purpose). The proxy already protects this path; the page
// double-checks defensively.
//
// Session check uses getClaims() — local JWT verify against cached JWKS, no
// Auth-server round-trip on the render path. See ADR 0021. The middleware
// keeps getUser() once per request for the authoritative refresh.

export const metadata = { title: "โปรไฟล์" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) {
    redirect("/login");
  }
  const userId = claimsData.claims.sub;

  const { data: row } = await supabase
    .from("users")
    // + spec 318 U2 readiness columns — same self-read, no extra round-trip.
    .select(
      "role, full_name, line_avatar_url, line_user_id, line_oa_friend, line_oa_friend_checked_at, telegram_chat_id",
    )
    .eq("id", userId)
    .maybeSingle();
  if (!row) {
    console.error("[/profile] users row missing", { userId });
    redirect("/login");
  }

  const role = row.role;
  const initialName = row.full_name ?? "";

  // Spec 291 U2 (TASK 8): the digital employee-ID card renders for internal
  // staff only — client/contractor/visitor keep the plain profile (no
  // employee identity to show). A second self-read (loadProfileCard) is
  // deliberately scoped to employee roles only, not collapsed into the guard
  // read above: loadProfileCard throws when the caller's users row is
  // missing (a programming-error invariant, per its own docs), which would
  // turn the existing "no users row → redirect('/login')" guard into an
  // unhandled exception. The guard read above stays the single source of
  // that redirect; this is an additional, narrower read.
  const employeeCard = isEmployeeRole(role) ? await loadProfileCard(supabase, userId) : null;

  // Spec 306 U3a + operator 2026-07-13 ("QR for every user, for consistency"):
  // every authenticated user's card shows a QR. Payload = the caller's workers.id
  // for on-site crew (current_user_worker_id, matches their printed badge + the
  // muster scanner), else their own account id (identity only, not muster-scannable
  // — office/external accounts don't muster). userId is always present here.
  const { data: workerId } = await supabase.rpc("current_user_worker_id");
  const badgeSvg = await toWorkerBadgeQrSvg(workerId ?? userId);
  // Spec 318 U2 — OA-friend readiness, built from the self-read above.
  const readiness = readinessFromUserRow(row);

  return (
    <PageShell>
      <BottomTabBar role={role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <div className="flex items-center gap-4">
          <AvatarSurface lineUrl={row.line_avatar_url} fullName={row.full_name} size={64} />
          <div>
            <h1 className="text-title text-ink font-bold tracking-tight">โปรไฟล์</h1>
            <p className="text-ink-secondary text-sm">แก้ไขชื่อที่แสดง</p>
          </div>
        </div>
      </DetailHeader>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
        <NotificationReadinessBanner readiness={readiness} />
        {employeeCard ? <EmployeeIdCard card={employeeCard} /> : null}
        <WorkerBadgeQr svg={badgeSvg} />

        <DisplayNameForm initialName={initialName} />

        <div className="flex justify-end pt-2">
          <LogoutButton />
        </div>
      </div>
    </PageShell>
  );
}
