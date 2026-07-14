// Spec 284 U2 / ADR 0080 — the org-chart READ surface. Shows every active
// department (U0), its head (departments.head_user_id), and its members (users
// grouped by department_id). super_admin-only: the users RLS "super_admin full
// access" is what permits the all-users read (a non-super would see only self),
// exactly like /settings/roles. Read-only — assignment is set_user_department /
// set_department_head (super_admin RPCs); an assign UI is a later unit.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { buildOrgChart } from "@/lib/org/org-chart";

export const metadata = { title: "โครงสร้างองค์กร" };

export default async function OrgChartPage() {
  await requireRole(["super_admin"]);

  const supabase = await createClient();
  const [{ data: deptRows }, { data: userRows }] = await Promise.all([
    supabase
      .from("departments")
      .select("id, key, name_th, is_active, head_user_id, sort_order")
      .order("sort_order", { ascending: true }),
    supabase.from("users").select("id, full_name, department_id"),
  ]);

  const chart = buildOrgChart(deptRows ?? [], userRows ?? []);
  const assigned = (userRows ?? []).filter((u) => u.department_id).length;

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">โครงสร้างองค์กร</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          {chart.length} แผนก · จัดคนเข้าแผนกแล้ว {assigned} คน
        </p>

        {chart.length === 0 ? (
          <EmptyNotice>ยังไม่มีแผนก</EmptyNotice>
        ) : (
          chart.map((d) => (
            <section
              key={d.key}
              aria-label={d.nameTh}
              className="border-edge bg-card flex flex-col gap-2 rounded-xl border p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-ink text-base font-semibold">{d.nameTh}</h2>
                <span className="text-ink-muted shrink-0 text-xs">{d.members.length} คน</span>
              </div>
              <p className="text-ink-secondary text-sm">
                หัวหน้าแผนก: {d.head ? d.head.name : "ยังไม่กำหนด"}
              </p>
              {d.members.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {d.members.map((m) => (
                    <li key={m.id} className="text-ink text-sm">
                      {m.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-muted text-sm">ยังไม่มีสมาชิก</p>
              )}
            </section>
          ))
        )}
      </section>
    </PageShell>
  );
}
