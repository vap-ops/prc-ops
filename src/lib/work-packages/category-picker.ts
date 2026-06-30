// Spec 226 / 207 U3c — the pure filter behind WpCategoryControl. The WP work-
// category picker offers the project's ACTIVE หมวดงาน only, but a WP already
// bound to a now-inactive category must still show that category as its current
// value (deactivate-not-delete must never silently drop a binding). Input order
// (sort_order) is preserved.

export interface WpCategoryOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export function categoryPickerOptions(
  categories: ReadonlyArray<WpCategoryOption>,
  boundId: string | null,
): WpCategoryOption[] {
  return categories.filter((c) => c.is_active || c.id === boundId);
}
