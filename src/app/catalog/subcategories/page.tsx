// Spec 219 U2 — /catalog/subcategories: the back-office manage screen for the
// subcategory taxonomy (a /catalog drill, DetailHeader back → /catalog, no
// HubNav). Gated to BACK_OFFICE_ROLES (the catalog curators). Lists active
// subcategories grouped by main category; add / edit / deactivate go through the
// create/update_catalog_subcategory RPCs.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { CATALOG_LABEL, ITEM_CATEGORY_LABEL, MANAGE_SUBCATEGORIES_LABEL } from "@/lib/i18n/labels";
import { AddSubcategory } from "@/components/features/catalog/add-subcategory";
import { EditSubcategory, type Subcategory } from "@/components/features/catalog/edit-subcategory";
import type { Database } from "@/lib/db/database.types";

type ItemCategory = Database["public"]["Enums"]["item_category"];

export const metadata = { title: MANAGE_SUBCATEGORIES_LABEL };

export default async function SubcategoriesPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const { data: rows } = await supabase
    .from("catalog_subcategories")
    .select("id, category, code, name, sort_order, is_active")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });

  const subs: Subcategory[] = (rows ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    code: r.code,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));

  // Enum order = the ITEM_CATEGORY_LABEL key order; show only categories present.
  const allCategories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];
  const present = allCategories.filter((c) => subs.some((s) => s.category === c));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/catalog" backLabel={CATALOG_LABEL}>
        <h1 className="text-title text-ink font-bold tracking-tight">
          {MANAGE_SUBCATEGORIES_LABEL}
        </h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <div className="flex justify-end">
          <AddSubcategory />
        </div>

        {present.length === 0 ? (
          <p className="text-ink-secondary text-body">ยังไม่มีหมวดย่อย — เพิ่มได้จากปุ่มด้านบน</p>
        ) : (
          <div className="flex flex-col gap-6">
            {present.map((cat) => {
              const catRows = subs.filter((s) => s.category === cat);
              return (
                <section key={cat} className="flex flex-col gap-2">
                  <h2 className="text-meta text-ink-secondary font-semibold">
                    {ITEM_CATEGORY_LABEL[cat]}{" "}
                    <span className="text-ink-muted">({catRows.length})</span>
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {catRows.map((s) => (
                      <li
                        key={s.id}
                        className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
                      >
                        <span className="text-ink bg-sunk text-meta rounded px-1.5 py-0.5 font-mono">
                          {s.code}
                        </span>
                        <span className="text-ink text-body min-w-0 flex-1 font-medium">
                          {s.name}
                        </span>
                        <EditSubcategory subcategory={s} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
