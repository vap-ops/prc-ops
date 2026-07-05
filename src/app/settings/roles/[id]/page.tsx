// Spec 265 U2 — the per-user detail off the super_admin role-admin list. Shows
// the user's role + full_name (their app name, user-owned) BESIDE the LINE
// ground-truth identity block (line_display_name + original avatar + last
// synced), so the super_admin can spot drift / impersonation at a glance — the
// point of the whole spec. super_admin-only (requireRole) — the users RLS
// "super_admin full access" already permits reading ANY user's row, so this uses
// the RLS-scoped session client (no admin client needed here, unlike the
// approval surface where a non-super approver can't read another user's row).
// Mirrors the /settings/usage/[actorId] per-user-detail precedent (DetailHeader
// back to /settings/roles). notFound() when the id doesn't resolve.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { isValidUuid } from "@/lib/validate/uuid";
import { LineIdentityBlock } from "@/components/features/identity/line-identity-block";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: "รายละเอียดผู้ใช้" };

export default async function RoleUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  await requireRole(["super_admin"]);
  const supabase = await createClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, full_name, role, line_display_name, line_avatar_url, line_synced_at")
    .eq("id", id)
    .maybeSingle();

  if (!user) notFound();

  const appName = user.full_name?.trim() || "(ไม่มีชื่อ)";

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings/roles" backLabel="กลับไปจัดการสิทธิ์ผู้ใช้">
        <h1 className="text-ink text-xl font-semibold tracking-tight">{appName}</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        <div className={CARD}>
          <p className="text-ink text-sm font-semibold">ข้อมูลในแอป</p>
          <dl className="text-ink-secondary mt-2 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-muted w-32 shrink-0">ชื่อในแอป</dt>
              <dd className="break-words">{appName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-muted w-32 shrink-0">สิทธิ์</dt>
              <dd className="break-words">{USER_ROLE_LABEL[user.role]}</dd>
            </div>
          </dl>
        </div>

        <LineIdentityBlock
          lineDisplayName={user.line_display_name}
          lineAvatarUrl={user.line_avatar_url}
          lineSyncedAt={user.line_synced_at}
        />
      </section>
    </PageShell>
  );
}
