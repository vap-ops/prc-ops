// Spec 46 P1 — current-state filter for labor_logs rows fetched from
// the DB (presence columns only — day_rate_snapshot is not readable by
// authenticated, by design). Supersede semantics per ADR 0009: a row is
// current when nothing points at it via superseded_by; tombstones
// (NULL day_fraction, ADR 0015) are then filtered out.

import type { Database } from "@/lib/db/database.types";

type Row = Database["public"]["Tables"]["labor_logs"]["Row"];
// The presence columns the current-state filter + its consumers use. The money
// snapshots (day_rate_snapshot, wht_pct_snapshot — spec 314 U3) are zero-grant,
// so the authenticated read never carries them; the spec-306-U5 derive columns
// (level_snapshot, source_muster_id) are write-only so far and no reader selects
// them — both excluded so a subset select still satisfies the type.
export type LaborLogRow = Omit<
  Row,
  "day_rate_snapshot" | "wht_pct_snapshot" | "level_snapshot" | "source_muster_id"
>;

export function currentLaborLogs(rows: LaborLogRow[]): LaborLogRow[] {
  const supersededIds = new Set(
    rows.map((r) => r.superseded_by).filter((id): id is string => id !== null),
  );
  return rows.filter((r) => !supersededIds.has(r.id) && r.day_fraction !== null);
}
