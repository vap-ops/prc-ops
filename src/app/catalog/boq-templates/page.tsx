// Spec 237 (ADR 0066 / S10-U2) — /catalog/boq-templates: the firm-wide BOQ
// template list (a /catalog drill, DetailHeader back → /catalog, no HubNav).
// Gated to BACK_OFFICE_ROLES (the BOQ writer tier pm/super/procurement/director).
// Active templates first, inactive shown muted; each links to its detail view. The
// AddBoqTemplate sheet creates a new template via create_boq_template.

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { CATALOG_LABEL, BOQ_TEMPLATES_LABEL, BOQ_TEMPLATE_TOTAL_LABEL } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { loadBoqTemplates } from "@/lib/boq/load";
import { AddBoqTemplate } from "@/components/features/boq/add-boq-template";

export const metadata = { title: BOQ_TEMPLATES_LABEL };

export default async function BoqTemplatesPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const templates = await loadBoqTemplates(supabase);

  // Active first; the loader's order (sort_order, code) is preserved within each
  // group by the stable sort.
  const ordered = [...templates].sort((a, b) => Number(b.isActive) - Number(a.isActive));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/catalog" backLabel={CATALOG_LABEL}>
        <h1 className="text-title text-ink font-bold tracking-tight">{BOQ_TEMPLATES_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">
            {BOQ_TEMPLATES_LABEL} <span className="text-ink-muted">({templates.length})</span>
          </h2>
          <AddBoqTemplate />
        </div>

        {ordered.length === 0 ? (
          <p className="text-ink-secondary text-body">ยังไม่มีแม่แบบ — เพิ่มได้จากปุ่มด้านบน</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/catalog/boq-templates/${t.id}`}
                  className={`border-edge bg-card rounded-control hover:bg-page focus-visible:ring-action flex items-center gap-3 border px-4 py-3 focus:outline-none focus-visible:ring-2 ${
                    t.isActive ? "" : "opacity-60"
                  }`}
                >
                  <span className="text-ink bg-sunk text-meta shrink-0 rounded px-1.5 py-0.5 font-mono">
                    {t.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink text-body block font-medium break-words">
                      {t.name}
                      {t.isActive ? "" : " · ปิดใช้งาน"}
                    </span>
                    <span className="text-ink-secondary text-meta block">
                      {t.lineCount} รายการ · {BOQ_TEMPLATE_TOTAL_LABEL} {baht(t.total)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
