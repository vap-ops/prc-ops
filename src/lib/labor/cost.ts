// Spec 68 P2 — labor cost aggregation. Runs over labor_logs rows read via
// the admin client (day_rate_snapshot is present — authenticated sessions
// can never read it, by column grant). This TS and the SQL
// freeze_wp_labor_cost RPC must agree: own/dc cost = Σ (day fraction ×
// rate snapshot) over CURRENT rows. The current-state filter (supersede
// anti-join + tombstone, ADR 0009/0015) is applied here so callers pass
// raw rows. Money is rendered only on the PM page (requireRole gated);
// these helpers carry no UI.

import type { Database } from "@/lib/db/database.types";

type Row = Database["public"]["Tables"]["labor_logs"]["Row"];
type PayType = Database["public"]["Enums"]["pay_type"];
type DayFraction = Database["public"]["Enums"]["day_fraction"];

// The columns the PM cost read selects (money included). Pinned to the
// schema Row so a column rename is a type error here.
export type CostInputRow = Pick<
  Row,
  | "id"
  | "worker_id"
  | "work_date"
  | "day_fraction"
  | "day_rate_snapshot"
  | "pay_type_snapshot"
  | "worker_name_snapshot"
  | "self_logged"
  | "superseded_by"
>;

export function fractionDays(f: DayFraction): number {
  return f === "full" ? 1 : 0.5;
}

export interface WorkerCostLine {
  workerId: string;
  name: string;
  type: PayType;
  days: number;
  cost: number;
  selfLogged: boolean;
}

export interface LaborCostSummary {
  ownCost: number;
  dcCost: number;
  total: number;
  workers: WorkerCostLine[];
  laborDays: string[];
}

// Current rows only: drop anything pointed at by superseded_by, then drop
// tombstones (NULL fraction). Same semantics as currentLaborLogs, inlined
// because the cost input carries the rate column the presence type omits.
function currentRows<
  T extends { id: string; superseded_by: string | null; day_fraction: DayFraction | null },
>(rows: ReadonlyArray<T>): T[] {
  const superseded = new Set(
    rows.map((r) => r.superseded_by).filter((id): id is string => id !== null),
  );
  return rows.filter((r) => !superseded.has(r.id) && r.day_fraction !== null);
}

export function aggregateLaborCost(rows: ReadonlyArray<CostInputRow>): LaborCostSummary {
  const current = currentRows(rows);

  const byWorker = new Map<string, WorkerCostLine>();
  const days = new Set<string>();
  let ownCost = 0;
  let dcCost = 0;

  for (const r of current) {
    // currentRows guarantees a non-null fraction.
    const d = fractionDays(r.day_fraction as DayFraction);
    const cost = d * r.day_rate_snapshot;
    days.add(r.work_date);
    if (r.pay_type_snapshot === "monthly") ownCost += cost;
    else dcCost += cost;

    const line = byWorker.get(r.worker_id);
    if (line) {
      line.days += d;
      line.cost += cost;
      line.selfLogged = line.selfLogged || r.self_logged;
    } else {
      byWorker.set(r.worker_id, {
        workerId: r.worker_id,
        name: r.worker_name_snapshot,
        type: r.pay_type_snapshot,
        days: d,
        cost,
        selfLogged: r.self_logged,
      });
    }
  }

  const workers = Array.from(byWorker.values()).sort((a, b) => a.name.localeCompare(b.name, "th"));

  return {
    ownCost,
    dcCost,
    total: ownCost + dcCost,
    workers,
    laborDays: Array.from(days).sort(),
  };
}

// The set of "workerId|workDate" keys for a WP's CURRENT labor rows. Used
// to keep only the over-allocations that actually touch this WP (the
// cross-WP query over-fetches by worker × date).
export function currentLaborPairKeys(
  rows: ReadonlyArray<
    Pick<Row, "id" | "worker_id" | "work_date" | "day_fraction" | "superseded_by">
  >,
): Set<string> {
  return new Set(currentRows(rows).map((r) => `${r.worker_id}|${r.work_date}`));
}

export interface OverAllocatedDay {
  workerId: string;
  workDate: string;
  totalDays: number;
}

// C5: a worker logged for more than a full day on one calendar date,
// summed across ALL work packages. Allowed, never blocked — surfaced in
// the PM cost view. Caller supplies the cross-WP current+superseded rows;
// the current-state filter runs here.
export function findOverAllocatedDays(
  rows: ReadonlyArray<
    Pick<Row, "id" | "worker_id" | "work_date" | "day_fraction" | "superseded_by">
  >,
): OverAllocatedDay[] {
  const current = currentRows(rows);
  const totals = new Map<string, OverAllocatedDay>();
  for (const r of current) {
    const key = `${r.worker_id}|${r.work_date}`;
    const d = fractionDays(r.day_fraction as DayFraction);
    const existing = totals.get(key);
    if (existing) existing.totalDays += d;
    else totals.set(key, { workerId: r.worker_id, workDate: r.work_date, totalDays: d });
  }
  return Array.from(totals.values())
    .filter((t) => t.totalDays > 1)
    .sort((a, b) =>
      a.workDate === b.workDate
        ? a.workerId.localeCompare(b.workerId)
        : a.workDate.localeCompare(b.workDate),
    );
}
