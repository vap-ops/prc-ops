// Spec 220 / ADR 0050 (G63) — super_admin role administration. Lists every user
// with their current role and lets the owner change it (the in-app replacement
// for raw-SQL promotion). super_admin-only — the users RLS "super_admin full
// access" already permits the all-users read, so this uses the RLS-scoped session
// client (no admin client). Visitors (awaiting promotion — the common task) sort
// first. The actual change goes through the gated, audited set_user_role RPC.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { type RoleUserVM } from "@/components/features/roles/role-admin-list";
import { RoleDirectory } from "@/components/features/roles/role-directory";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: "จัดการสิทธิ์ผู้ใช้" };

export default async function RolesPage() {
  const ctx = await requireRole(["super_admin"]);

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("users")
    .select("id, full_name, role, created_at")
    .order("created_at", { ascending: true });
  const users = rows ?? [];

  const vms: RoleUserVM[] = users.map((u) => ({
    id: u.id,
    name: u.full_name?.trim() || "(ไม่มีชื่อ)",
    role: u.role,
    isSelf: u.id === ctx.id,
  }));

  const visitorCount = users.filter((u) => u.role === "visitor").length;

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">จัดการสิทธิ์ผู้ใช้</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          ทั้งหมด {users.length} คน
          {visitorCount > 0 ? ` · รอกำหนดสิทธิ์ ${visitorCount} คน` : ""}
        </p>

        {users.length === 0 ? (
          <EmptyNotice>ยังไม่มีผู้ใช้</EmptyNotice>
        ) : (
          // Spec 316 U2: name search + the grouped sections (visitor promotion
          // queue first, feedback d00c3d0e) live in the RoleDirectory island.
          <RoleDirectory users={vms} />
        )}
      </section>
    </PageShell>
  );
}
