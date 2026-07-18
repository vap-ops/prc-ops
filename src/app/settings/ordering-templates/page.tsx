// Spec 245 U4 — /settings/ordering-templates: the ordering-plan template list
// (a /settings drill, DetailHeader back → /settings). Gated to the supply-plan
// write tier (§4: PM/super/director/procurement — SUPPLY_PLAN_ROLES). Lists the
// 2 seeded global templates (is_template=true, project_id=null); each opens its
// stripped-down editor. NO create-new-template UI (D4 — only the seeded ones
// are editable in v1).

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { SUPPLY_PLAN_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { safeBackHref } from "@/lib/nav/back-href";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { ORDERING_TEMPLATES_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: ORDERING_TEMPLATES_LABEL };

export default async function OrderingTemplatesPage({
  searchParams,
}: {
  // Spec 327 U6b — multi-parent page (settings hub + /procurement chip row):
  // the back chip follows the ?from referrer (nav-coherence Decision 1).
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;
  // Spec 327 U6b fresh-eyes: a template drill must not kill the referrer
  // trail — the row threads THIS list (with its own from) as the child's
  // referrer, so backing out of the editor returns here with the chip intact.
  const fromValue = Array.isArray(from) ? from[0] : from;
  const listSelf = fromValue
    ? `/settings/ordering-templates?from=${encodeURIComponent(fromValue)}`
    : "/settings/ordering-templates";
  const ctx = await requireRole(SUPPLY_PLAN_ROLES);

  const supabase = await createClient();
  const { data: templateRows } = await supabase
    .from("supply_plans")
    .select("id, name")
    .eq("is_template", true)
    .order("name", { ascending: true });
  const templates = (templateRows ?? []).map((t) => ({ id: t.id, name: t.name ?? "เทมเพลต" }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/settings")} backLabel="กลับไปตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{ORDERING_TEMPLATES_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <p className="text-ink-secondary text-meta">
          แม่แบบรายการวัสดุสำหรับเริ่มแผนจัดหาของโครงการใหม่ — แก้ไขที่นี่
          แล้วนำไปใช้ได้จากหน้าแผนจัดหาของแต่ละโครงการ (“ใช้เทมเพลตนี้”)
        </p>

        {templates.length === 0 ? (
          <p className="text-ink-secondary text-body">ยังไม่มีเทมเพลต</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/settings/ordering-templates/${t.id}?from=${encodeURIComponent(listSelf)}`}
                  className="border-edge bg-card rounded-control hover:bg-sunk focus-visible:ring-action flex items-center gap-3 border px-4 py-3 focus:outline-none focus-visible:ring-2"
                >
                  <span className="text-ink text-body min-w-0 flex-1 font-semibold break-words">
                    {t.name}
                  </span>
                  <ChevronRight aria-hidden className="text-ink-muted size-5 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
