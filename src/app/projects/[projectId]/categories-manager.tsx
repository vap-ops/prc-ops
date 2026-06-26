// Spec 207 U3 — the "หมวดงาน" (project work-category) manager section on the
// project page. Server component: lists the project's categories (code · name)
// and hosts the AddCategorySheet. The in-app home for per-project work-category
// authoring (feedback 1a556584). PM-only / open-project; the add button is the
// AddCategorySheet client island. Rename / reorder / deactivate + the WP-binding
// control are later units (U3b/U3c). Mirrors DeliverablesManager (spec 164).

import { PROJECT_CATEGORY_LABEL } from "@/lib/i18n/labels";
import { AddCategorySheet } from "./add-category-sheet";

export interface CategoryManagerRow {
  id: string;
  code: string;
  name: string;
}

export function CategoriesManager({
  projectId,
  categories,
}: {
  projectId: string;
  categories: CategoryManagerRow[];
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="categories" className="text-section text-ink font-semibold">
          {PROJECT_CATEGORY_LABEL}
        </h2>
        <AddCategorySheet projectId={projectId} />
      </div>

      {categories.length === 0 ? (
        <div className="rounded-card border-edge bg-sunk text-ink-secondary border px-4 py-3 text-sm">
          ยังไม่มีหมวดงาน — เพิ่มหมวดเพื่อจัดกลุ่มงานและผูกแบบก่อสร้างของแต่ละหมวด
        </div>
      ) : (
        <ul className="rounded-card border-edge bg-card divide-edge divide-y border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2">
              <span className="text-meta text-ink-secondary font-mono">{c.code}</span>
              <span className="text-body text-ink min-w-0 flex-1 truncate">{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
