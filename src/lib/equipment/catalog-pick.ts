// Spec 385 U2 — pick-from-ทะเบียน helpers.
//
// The instance name is DERIVED from the SKU (`<SKU> No.<n+1>`), never typed:
// the operator's numbering convention is the identity the crew already stencils
// on the machines, and deriving it here means the free-text duplicate disease
// (spec 344, 27 pairs on the material side) cannot return through the pick path.
// The server recomputes the same derivation authoritatively — this module keeps
// ONE rule for both sides.

export interface CatalogSkuOption {
  id: string;
  name: string;
  categoryId: string;
  brand: string | null;
  model: string | null;
  defaultTracking: "unit" | "bulk";
}

export interface CatalogSkuGroup {
  id: string;
  name: string;
  skus: CatalogSkuOption[];
}

/** อื่น ๆ — SKUs whose category id no longer resolves still need a shelf. */
const UNKNOWN_GROUP_ID = "__unknown__";
const UNKNOWN_GROUP_LABEL = "อื่น ๆ";

export function nextUnitName(skuName: string, existingUnitCount: number): string {
  return `${skuName.trim()} No.${existingUnitCount + 1}`;
}

/**
 * Group SKUs for the picker's <optgroup>s, in the categories prop's order (the
 * page orders it by name). Empty groups drop; a SKU with an unresolvable
 * category parks in a trailing อื่น ๆ group rather than silently vanishing —
 * a pick list that loses rows recreates "the registry shows nothing" (367 §1.1).
 */
export function groupSkusByCategory(
  skus: CatalogSkuOption[],
  categories: { id: string; name: string }[],
): CatalogSkuGroup[] {
  const known = new Set(categories.map((c) => c.id));
  const groups = categories
    .map((c) => ({ id: c.id, name: c.name, skus: skus.filter((s) => s.categoryId === c.id) }))
    .filter((g) => g.skus.length > 0);
  const orphans = skus.filter((s) => !known.has(s.categoryId));
  if (orphans.length > 0) {
    groups.push({ id: UNKNOWN_GROUP_ID, name: UNKNOWN_GROUP_LABEL, skus: orphans });
  }
  return groups;
}
