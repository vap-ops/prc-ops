// Spec 274 U2 — the super_admin "View as role" picker. Gated on the REAL role
// (getClaims + users SELECT, like /settings) — NOT requireRole, which would see
// the overridden effective role and bounce a super_admin who has already assumed
// a role. Each role is a form posting setAssumedRole (which lands on that role's
// home); the current view (if any) is highlighted with an exit control.

import { redirect } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { createClient } from "@/lib/db/server";
import { ASSUMABLE_ROLES } from "@/lib/auth/effective-role";
import { getActiveViewAs } from "@/lib/auth/view-as-state.server";
import { setAssumedRole, clearAssumedRole } from "../roles-view-as/actions";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: "ดูมุมมองตาม role" };

export default async function ViewAsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login");
  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", claims.claims.sub)
    .maybeSingle();
  if (row?.role !== "super_admin") redirect("/");

  const active = await getActiveViewAs();

  return (
    <PageShell>
      {/* Real-identity control surface — the super_admin's own tab bar + a back
          chip to /settings (spec 63). Reachable even while a role is assumed. */}
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">ดูมุมมองตาม role</h1>
      </DetailHeader>

      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          เปิดแอปเสมือนเป็น role อื่น เพื่อดูสิ่งที่ผู้ใช้ role นั้นเห็น (เมนู หน้าหลัก และหน้าต่าง
          ๆ) โดยยังคงเป็นบัญชี super_admin ของคุณเอง หน้าที่เป็นข้อมูลส่วนตัวของแต่ละคนจะว่าง
          เพราะคุณไม่มีข้อมูลส่วนตัวใน role นั้น
        </p>

        {active ? (
          <div
            className={`${CARD} border-attn bg-attn-soft flex items-center justify-between gap-3`}
          >
            <span className="text-attn-ink min-w-0 text-sm">
              กำลังดูในมุมมอง: <span className="font-bold">{USER_ROLE_LABEL[active]}</span>
            </span>
            <form action={clearAssumedRole}>
              <button
                type="submit"
                className="border-attn text-attn-ink rounded-control shrink-0 border px-3 py-1 text-sm font-semibold transition-opacity hover:opacity-80"
              >
                ออกจากมุมมอง
              </button>
            </form>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {ASSUMABLE_ROLES.map((r) => {
            const isActive = active === r;
            return (
              <form key={r} action={setAssumedRole.bind(null, r)}>
                <button
                  type="submit"
                  aria-current={isActive ? "true" : undefined}
                  className={`${CARD} w-full text-left text-sm font-semibold ${
                    isActive
                      ? "border-action text-action ring-action ring-1"
                      : "text-ink hover:bg-sunk"
                  }`}
                >
                  {USER_ROLE_LABEL[r]}
                  <span className="text-ink-muted mt-0.5 block font-mono text-xs font-normal">
                    {r}
                  </span>
                </button>
              </form>
            );
          })}
        </div>
      </section>
    </PageShell>
  );
}
