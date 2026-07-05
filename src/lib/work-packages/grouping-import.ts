// Spec 270 U2a — งาน/งานย่อย grouping import: template parse, validation, diff plan.
// Pure layer: no DB access. Template columns (TSV, spec 270 §4):
//   SubOf | WP (new code) | OldCode (join key to the existing row) | ชื่องาน
// One row per งาน (SubOf empty) and per งานย่อย (SubOf = its งาน's WP code).
// Grouping is mandatory (spec §2 D6): a งานย่อย row without SubOf is an error.
// Rows are matched to existing WPs ONLY by OldCode — renames and renumbers are
// simultaneous, so name-matching is unsafe by design.

export type GroupingRow = {
  subOf: string | null;
  code: string;
  oldCode: string | null;
  name: string;
};

export type ExistingWp = {
  code: string;
  name: string;
  isGroup: boolean;
  parentCode: string | null;
};

export type GroupingIssue = {
  /** 1-based line number in the pasted text. */
  row: number;
  /** The row's WP code when known. */
  code: string | null;
  message: string;
};

export type GroupingPlan = {
  groupsToCreate: { code: string; name: string }[];
  groupsMatched: { oldCode: string; code: string }[];
  leavesToCreate: { code: string; name: string }[];
  renamed: { oldCode: string; from: string; to: string }[];
  recoded: { oldCode: string; to: string }[];
  /** Leaves gaining their first parent. */
  parented: number;
  /** Leaves moving from one งาน to another. */
  reparented: number;
  unchangedNames: number;
};

export type GroupingValidation = {
  errors: GroupingIssue[];
  warnings: GroupingIssue[];
  plan: GroupingPlan | null;
};

const HEADER_FIRST_CELL = "SubOf";
const CODE_FORMAT = /^WP-\d{3,}$/;

type ParsedRow = GroupingRow & { line: number };

export function parseGroupingTemplate(text: string): {
  rows: GroupingRow[];
  errors: GroupingIssue[];
} {
  const rows: ParsedRow[] = [];
  const errors: GroupingIssue[] = [];
  const lines = text.split("\n");

  let headerSkipped = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue;
    const cells = raw.split("\t").map((c) => c.trim());
    if (!headerSkipped && cells[0] === HEADER_FIRST_CELL) {
      headerSkipped = true;
      continue;
    }
    headerSkipped = true;
    if (cells.length !== 4) {
      errors.push({
        row: i + 1,
        code: null,
        message: `expected 4 columns (SubOf, WP, OldCode, ชื่องาน) but found ${cells.length}`,
      });
      continue;
    }
    const [subOf = "", code = "", oldCode = "", name = ""] = cells;
    if (code === "") {
      errors.push({ row: i + 1, code: null, message: "the WP code column is empty" });
      continue;
    }
    if (name === "") {
      errors.push({ row: i + 1, code, message: "the ชื่องาน column is empty" });
      continue;
    }
    rows.push({
      subOf: subOf === "" ? null : subOf,
      code,
      oldCode: oldCode === "" ? null : oldCode,
      name,
      line: i + 1,
    });
  }

  return { rows: rows.map(({ line: _line, ...r }) => r), errors };
}

export function validateGrouping(rows: GroupingRow[], existing: ExistingWp[]): GroupingValidation {
  const errors: GroupingIssue[] = [];
  const warnings: GroupingIssue[] = [];
  const byExistingCode = new Map(existing.map((w) => [w.code, w]));

  // Duplicate new codes / OldCodes.
  const seenCodes = new Map<string, number>();
  const seenOld = new Map<string, number>();
  rows.forEach((r, i) => {
    const line = i + 1;
    const dup = seenCodes.get(r.code);
    if (dup !== undefined) {
      errors.push({ row: line, code: r.code, message: `duplicate WP code ${r.code}` });
    } else {
      seenCodes.set(r.code, line);
    }
    if (r.oldCode !== null) {
      const dupOld = seenOld.get(r.oldCode);
      if (dupOld !== undefined) {
        errors.push({ row: line, code: r.code, message: `duplicate OldCode ${r.oldCode}` });
      } else {
        seenOld.set(r.oldCode, line);
      }
    }
  });

  // Classify rows. A row with SubOf is a งานย่อย. A row without SubOf is a งาน —
  // unless its OldCode points at an existing งานย่อย, which is ambiguous-and-wrong
  // either way (a งานย่อย missing SubOf, or an is_group flip attempt).
  const groupRows: GroupingRow[] = [];
  const leafRows: GroupingRow[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    if (r.subOf !== null) {
      leafRows.push(r);
      return;
    }
    const old = r.oldCode === null ? undefined : byExistingCode.get(r.oldCode);
    if (old !== undefined && !old.isGroup) {
      errors.push({
        row: line,
        code: r.code,
        message:
          `OldCode ${r.oldCode} is an existing งานย่อย (leaf) but the row has no SubOf — ` +
          `either add its SubOf, or stop converting a งานย่อย into a งาน (is_group is immutable)`,
      });
      return;
    }
    groupRows.push(r);
  });

  const groupCodes = new Set(groupRows.map((g) => g.code));

  // Group rows: OldCode (when present) must match an existing งาน.
  for (const g of groupRows) {
    if (g.oldCode !== null && !byExistingCode.has(g.oldCode)) {
      errors.push({
        row: rows.indexOf(g) + 1,
        code: g.code,
        message: `OldCode ${g.oldCode} does not exist in this project`,
      });
    }
  }

  // Leaf rows: SubOf must reference a งาน row in the file; OldCode must be
  // absent (new งานย่อย) or an existing งานย่อย.
  for (const l of leafRows) {
    const line = rows.indexOf(l) + 1;
    if (l.subOf !== null && !groupCodes.has(l.subOf)) {
      errors.push({
        row: line,
        code: l.code,
        message: `SubOf ${l.subOf} is not a งาน (group) row in this file`,
      });
    }
    if (l.oldCode !== null) {
      const old = byExistingCode.get(l.oldCode);
      if (old === undefined) {
        errors.push({
          row: line,
          code: l.code,
          message: `OldCode ${l.oldCode} does not exist in this project`,
        });
      } else if (old.isGroup) {
        errors.push({
          row: line,
          code: l.code,
          message: `OldCode ${l.oldCode} is an existing งาน — it cannot become a งานย่อย (is_group is immutable)`,
        });
      }
    }
  }

  // No silent drops: every existing WP must appear as exactly one OldCode.
  const oldCodesInFile = new Set(rows.map((r) => r.oldCode).filter((c): c is string => c !== null));
  for (const w of existing) {
    if (!oldCodesInFile.has(w.code)) {
      errors.push({
        row: 0,
        code: w.code,
        message: `existing WP ${w.code} is missing from the file (no row carries it as OldCode) — removals are not part of this import`,
      });
    }
  }

  // Warnings: childless groups, odd code formats.
  const referencedGroups = new Set(leafRows.map((l) => l.subOf));
  for (const g of groupRows) {
    if (!referencedGroups.has(g.code)) {
      warnings.push({
        row: rows.indexOf(g) + 1,
        code: g.code,
        message: `งาน ${g.code} is childless (no งานย่อย points at it)`,
      });
    }
  }
  for (const r of rows) {
    if (!CODE_FORMAT.test(r.code)) {
      warnings.push({
        row: rows.indexOf(r) + 1,
        code: r.code,
        message: `code ${r.code} does not match the WP-### format`,
      });
    }
  }

  if (errors.length > 0) return { errors, warnings, plan: null };

  // Diff plan.
  const plan: GroupingPlan = {
    groupsToCreate: [],
    groupsMatched: [],
    leavesToCreate: [],
    renamed: [],
    recoded: [],
    parented: 0,
    reparented: 0,
    unchangedNames: 0,
  };
  for (const g of groupRows) {
    if (g.oldCode === null) plan.groupsToCreate.push({ code: g.code, name: g.name });
    else plan.groupsMatched.push({ oldCode: g.oldCode, code: g.code });
  }
  for (const r of rows) {
    if (r.oldCode === null) continue;
    const old = byExistingCode.get(r.oldCode);
    if (old === undefined) continue;
    if (old.name !== r.name) {
      plan.renamed.push({ oldCode: r.oldCode, from: old.name, to: r.name });
    } else {
      plan.unchangedNames++;
    }
    if (r.oldCode !== r.code) plan.recoded.push({ oldCode: r.oldCode, to: r.code });
  }
  const groupOldByCode = new Map(groupRows.map((g) => [g.code, g.oldCode] as const));
  for (const l of leafRows) {
    if (l.oldCode === null) {
      plan.leavesToCreate.push({ code: l.code, name: l.name });
      continue;
    }
    const old = byExistingCode.get(l.oldCode);
    if (old === undefined || l.subOf === null) continue;
    const newParentOldCode = groupOldByCode.get(l.subOf) ?? null;
    if (old.parentCode === null) plan.parented++;
    else if (old.parentCode !== newParentOldCode) plan.reparented++;
  }

  return { errors, warnings, plan };
}

export function buildGroupingTemplate(existing: ExistingWp[]): string {
  const lines = [["SubOf", "WP", "OldCode", "ชื่องาน"].join("\t")];
  for (const w of existing) {
    lines.push([w.parentCode ?? "", w.code, w.code, w.name].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}
