// Spec 270 U5 — pure WP-picker shaping. A picker offers งานย่อย ONLY; in an
// adopted project the options group under งาน headings (native <optgroup>).
// Groups themselves are never options — they are grouping entities (ADR 0074).
// No I/O, no React; shared by the supply-plan picker (and any future picker).

import { compareWpCodes } from "@/lib/work-packages/group-roster";

export interface WpPickerRow {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
  parentId: string | null;
}

export interface WpPickerOption {
  id: string;
  code: string;
  name: string;
}

export interface WpPickerGroups {
  /** One section per non-empty งาน, sorted by code; options sorted inside. */
  sections: Array<{ label: string; options: WpPickerOption[] }>;
  /** Leaves with no (known) parent — legacy remnants; sorted by code. */
  ungrouped: WpPickerOption[];
}

const toOption = ({ id, code, name }: WpPickerRow): WpPickerOption => ({ id, code, name });

export function buildWpPickerGroups(rows: ReadonlyArray<WpPickerRow>): WpPickerGroups {
  const groups = rows.filter((r) => r.isGroup).sort(compareWpCodes);
  const groupIds = new Set(groups.map((g) => g.id));
  const leaves = rows.filter((r) => !r.isGroup);

  const byParent = new Map<string, WpPickerRow[]>();
  const ungrouped: WpPickerRow[] = [];
  for (const leaf of leaves) {
    if (leaf.parentId !== null && groupIds.has(leaf.parentId)) {
      const bucket = byParent.get(leaf.parentId);
      if (bucket) bucket.push(leaf);
      else byParent.set(leaf.parentId, [leaf]);
    } else {
      ungrouped.push(leaf);
    }
  }

  return {
    sections: groups.flatMap((g) => {
      const children = (byParent.get(g.id) ?? []).sort(compareWpCodes);
      if (children.length === 0) return []; // no empty optgroups
      return [{ label: `${g.code} ${g.name}`, options: children.map(toOption) }];
    }),
    ungrouped: ungrouped.sort(compareWpCodes).map(toOption),
  };
}
