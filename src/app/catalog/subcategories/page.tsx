// Spec 219 U2 / 221 U3 — /catalog/subcategories: the back-office TAXONOMY manage
// screen (a /catalog drill, DetailHeader back → /catalog, no HubNav). Gated to
// BACK_OFFICE_ROLES. Two sections: the managed MAIN categories
// (catalog_categories — add / recode / rename / deactivate via the U1
// create/update_catalog_category RPCs, spec 221) and the subcategories grouped
// under each (spec 219). The subcategory section still groups by the enum (the 13
// seeded categories); subcategories under brand-new user-categories + tagging
// items with them is a follow-up unit (needs the create_catalog_subcategory
// p_category arg made optional).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import {
  CATALOG_CATEGORY_LABEL,
  CATALOG_LABEL,
  CATALOG_SUBCATEGORY_LABEL,
  ITEM_CATEGORY_LABEL,
  MANAGE_TAXONOMY_LABEL,
} from "@/lib/i18n/labels";
import { AddCategory } from "@/components/features/catalog/add-category";
import { EditCategory, type Category } from "@/components/features/catalog/edit-category";
import { AddSubcategory } from "@/components/features/catalog/add-subcategory";
import { EditSubcategory, type Subcategory } from "@/components/features/catalog/edit-subcategory";
import type { Database } from "@/lib/db/database.types";

type ItemCategory = Database["public"]["Enums"]["item_category"];

export const metadata = { title: MANAGE_TAXONOMY_LABEL };

export default async function TaxonomyPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();

  const { data: categoryRows } = await supabase
    .from("catalog_categories")
    .select("id, code, name, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  const categories: Category[] = (categoryRows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));

  const { data: subRows } = await supabase
    .from("catalog_subcategories")
    .select("id, category, code, name, sort_order, is_active")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  const subs: Subcategory[] = (subRows ?? []).map((r) => ({
    id: r.id,
    // Spec 221: category is now nullable (vestigial enum); non-null for the 13 enum-backed categories.
    category: r.category as NonNullable<typeof r.category>,
    code: r.code,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));

  // Subcategories group under the enum (the 13 seeded categories) for now.
  const allCategories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];
  const present = allCategories.filter((c) => subs.some((s) => s.category === c));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/catalog" backLabel={CATALOG_LABEL}>
        <h1 className="text-title text-ink font-bold tracking-tight">{MANAGE_TAXONOMY_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-8 px-5 py-6`}>
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">
              {CATALOG_CATEGORY_LABEL} <span className="text-ink-muted">({categories.length})</span>
            </h2>
            <AddCategory />
          </div>
          <ul className="flex flex-col gap-2">
            {categories.map((c) => (
              <li
                key={c.id}
                className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
              >
                <span className="text-ink bg-sunk text-meta rounded px-1.5 py-0.5 font-mono">
                  {c.code}
                </span>
                <span className="text-ink text-body min-w-0 flex-1 font-medium">{c.name}</span>
                <EditCategory category={c} />
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">
              {CATALOG_SUBCATEGORY_LABEL}
            </h2>
            <AddSubcategory />
          </div>

          {present.length === 0 ? (
            <p className="text-ink-secondary text-body">ยังไม่มีหมวดย่อย — เพิ่มได้จากปุ่มด้านบน</p>
          ) : (
            <div className="flex flex-col gap-6">
              {present.map((cat) => {
                const subForCat = subs.filter((s) => s.category === cat);
                return (
                  <div key={cat} className="flex flex-col gap-2">
                    <h3 className="text-meta text-ink-secondary font-semibold">
                      {ITEM_CATEGORY_LABEL[cat]}{" "}
                      <span className="text-ink-muted">({subForCat.length})</span>
                    </h3>
                    <ul className="flex flex-col gap-2">
                      {subForCat.map((s) => (
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
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
