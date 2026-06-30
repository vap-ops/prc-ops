// Spec 229 (ADR 0066 / S8) — the WP-detail work-category badge. Surfaces the
// หมวดงาน the work package is bound to (a project category, spec 207/226), or a
// muted nudge when the WP is still uncategorised. Pure display (no state, no
// writes) — the picker scoping that rides the same work-category is resolved
// separately in the page loader. Rendered in the WP detail header for every
// WP_DETAIL_ROLES viewer (read-only safe).

import { PROJECT_CATEGORY_LABEL, WORK_CATEGORY_UNSET_LABEL } from "@/lib/i18n/labels";

export function WorkCategoryBadge({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span className="border-edge text-ink-muted text-meta inline-flex max-w-full items-center rounded-full border border-dashed px-2.5 py-0.5">
        {WORK_CATEGORY_UNSET_LABEL}
      </span>
    );
  }
  return (
    <span className="border-edge bg-sunk text-ink text-meta inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5">
      <span className="text-ink-muted">{PROJECT_CATEGORY_LABEL}</span>
      <span className="truncate font-medium">{name}</span>
    </span>
  );
}
