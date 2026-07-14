// Spec 270 U5 — pure WP-picker shaping. A picker offers งานย่อย ONLY; in an
// adopted project the options group under งาน headings (native <optgroup>).
// Groups themselves are never options — they are grouping entities (ADR 0074).
// No I/O, no React; shared by the supply-plan picker (and any future picker).

import { compareWpCodes } from "@/lib/work-packages/group-roster";
import { wpDisplayCode } from "@/lib/work-packages/format-code";

export interface WpPickerRow {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
  parentId: string | null;
  /** Spec 301 U3: reconciled W0x code for the text letter-code (optional —
   *  callers that don't resolve categories keep the raw code). */
  categoryCode?: string | null;
}

export interface WpPickerOption {
  id: string;
  code: string;
  name: string;
  categoryCode: string | null;
}

export interface WpPickerGroups {
  /** One section per non-empty งาน, sorted by code; options sorted inside. */
  sections: Array<{ label: string; options: WpPickerOption[] }>;
  /** Leaves with no (known) parent — legacy remnants; sorted by code. */
  ungrouped: WpPickerOption[];
}

const toOption = ({ id, code, name, categoryCode }: WpPickerRow): WpPickerOption => ({
  id,
  code,
  name,
  categoryCode: categoryCode ?? null,
});

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
      // Spec 301 U3: optgroup labels are text-only — letter-code via wpDisplayCode.
      return [
        {
          label: `${wpDisplayCode(g.code, g.categoryCode)} ${g.name}`,
          options: children.map(toOption),
        },
      ];
    }),
    ungrouped: ungrouped.sort(compareWpCodes).map(toOption),
  };
}
