// Spec 331 — pure readers over the document-type registry.
//
// Deliberately typed against structural row shapes rather than the generated
// Tables<> aliases: the generated rows satisfy these, and keeping the pure logic
// free of the DB type surface lets it be unit-tested without a round trip (the
// group-documents.ts precedent, which is the other half of this page's reads).

export interface DocCategoryRow {
  id: string;
  code: string;
  name_th: string;
  sort_order: number;
  is_active: boolean;
}

export interface DocTypeRow {
  id: string;
  category_id: string;
  code: string;
  name_th: string;
  hint: string | null;
  is_singleton: boolean;
  is_required: boolean;
  requires_expiry: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface DocTypeGroup {
  category: DocCategoryRow;
  types: DocTypeRow[];
}

const bySortOrder = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

/** The upload picker's option list: active types under active categories. */
export function groupTypesByCategory(
  categories: DocCategoryRow[],
  types: DocTypeRow[],
): DocTypeGroup[] {
  const active = types.filter((t) => t.is_active).sort(bySortOrder);
  return categories
    .filter((c) => c.is_active)
    .sort(bySortOrder)
    .map((category) => ({
      category,
      types: active.filter((t) => t.category_id === category.id),
    }))
    .filter((g) => g.types.length > 0);
}

/**
 * Spec 331 §6 — the ยังขาด checklist. `liveDocuments` is the CURRENT set (already
 * anti-joined + tombstone-filtered by groupDocuments), so a retired document
 * correctly puts its type back on the missing list.
 */
export function missingRequiredTypes(
  types: DocTypeRow[],
  liveDocuments: ReadonlyArray<{ type_id: string | null }>,
): DocTypeRow[] {
  const held = new Set(
    liveDocuments.map((d) => d.type_id).filter((id): id is string => id !== null),
  );
  return types.filter((t) => t.is_active && t.is_required && !held.has(t.id)).sort(bySortOrder);
}
