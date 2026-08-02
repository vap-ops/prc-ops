// Spec 389 U4 — pure mapping-suggestion builder for the PD surface.
//
// Two bases, priority-ordered:
//   1. "old_id"  — the catalogue row's source_note carries the Vol.4 sheet's
//                  OldID ("เดิม: WP-xxx"); the Vol.2 name for that id
//                  (src/lib/wp-catalog/vol2-names.json — extracted from the
//                  Vol.2 tab of the operator's "WP โพธิ์ทอง" Google Sheet,
//                  2026-08-03 revision, 378 entries) equals the live WP's
//                  name. The strong bridge: live โพธิ์ทอง WP names ARE Vol.2
//                  names.
//   2. "name"    — the catalogue name equals the live WP name directly.
//
// Equality is whitespace-normalised. Ambiguity (2+ candidates on a basis) or a
// group/leaf grain mismatch yields NO suggestion — a wrong pre-selection costs
// a mis-mapping, an empty one costs a manual pick.

export interface SuggestionWp {
  id: string;
  code: string;
  name: string;
  is_group: boolean;
}

export interface SuggestionItem {
  id: string;
  code: string;
  name: string;
  is_group: boolean;
  source_note: string | null;
}

export interface MappingSuggestion {
  itemId: string;
  basis: "old_id" | "name";
}

const norm = (s: string): string => s.replace(/\s+/g, "").trim();

const OLD_ID_RE = /เดิม:\s*(WP-\d+)/;

export function buildMappingSuggestions(
  wps: ReadonlyArray<SuggestionWp>,
  items: ReadonlyArray<SuggestionItem>,
  vol2Names: Readonly<Record<string, string>>,
): Map<string, MappingSuggestion> {
  // basis 1: normalized Vol.2 name (of the item's OldID) → items
  const byOldName = new Map<string, SuggestionItem[]>();
  // basis 2: normalized item name → items
  const byName = new Map<string, SuggestionItem[]>();

  for (const item of items) {
    const oldId = item.source_note?.match(OLD_ID_RE)?.[1];
    const oldName = oldId ? vol2Names[oldId] : undefined;
    if (oldName) {
      const k = norm(oldName);
      byOldName.set(k, [...(byOldName.get(k) ?? []), item]);
    }
    const nk = norm(item.name);
    byName.set(nk, [...(byName.get(nk) ?? []), item]);
  }

  const out = new Map<string, MappingSuggestion>();
  for (const wp of wps) {
    const key = norm(wp.name);

    const viaOld = (byOldName.get(key) ?? []).filter((i) => i.is_group === wp.is_group);
    if (viaOld.length === 1 && viaOld[0]) {
      out.set(wp.id, { itemId: viaOld[0].id, basis: "old_id" });
      continue;
    }
    if (viaOld.length > 1) continue; // ambiguous on the strong basis — hands off

    const viaName = (byName.get(key) ?? []).filter((i) => i.is_group === wp.is_group);
    if (viaName.length === 1 && viaName[0]) {
      out.set(wp.id, { itemId: viaName[0].id, basis: "name" });
    }
  }
  return out;
}
