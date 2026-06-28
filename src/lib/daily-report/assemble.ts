// Spec 212 U2 — pure assembly of a day's labour into the report's by-work grouping.
// The WORK (work package) is the spine; worker type is a tag; a null work package
// is general site work ("งานทั่วไป", sorted last). Headcount de-dupes a worker who
// logged to more than one WP. Late/OT are tallied for the summary. No DB here —
// load.ts feeds it real rows; the screen pairs this with the SA-authored text.

import type { WorkerType, DailyReportException } from "./flex";

export interface AttendanceLaborRow {
  workerId: string;
  workerName: string;
  workerType: WorkerType;
  workPackageId: string | null;
  exception?: DailyReportException | null;
}

export interface AttendanceWorkPackage {
  id: string;
  code: string;
  name: string;
  deliverableCode: string | null;
}

export interface AssembledEntry {
  wpId: string | null;
  /** The deliverable/WP code chip ("D03"), or null for general site work. */
  wpCode: string | null;
  /** WP name, or "งานทั่วไป" for the no-WP bucket. */
  title: string;
  headcount: number;
  workers: { name: string; type: WorkerType }[];
  exceptions: DailyReportException[];
}

export interface AssembledAttendance {
  entries: AssembledEntry[];
  headcountByType: { company: number; dc: number; subcon: number };
  lateCount: number;
  otCount: number;
  totalHeadcount: number;
}

const GENERAL_TITLE = "งานทั่วไป";

export function assembleAttendance(
  labor: readonly AttendanceLaborRow[],
  workPackages: readonly AttendanceWorkPackage[],
): AssembledAttendance {
  const wpById = new Map(workPackages.map((w) => [w.id, w]));

  // Group rows by WP id (null → general), keeping real WPs in first-appearance
  // order; the general bucket is appended last regardless of when it appeared.
  const order: (string | null)[] = [];
  const groups = new Map<string | null, AttendanceLaborRow[]>();
  for (const row of labor) {
    const key = row.workPackageId;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(row);
  }
  const orderedKeys: (string | null)[] = [
    ...order.filter((k) => k !== null),
    ...(groups.has(null) ? [null] : []),
  ];

  const entries: AssembledEntry[] = orderedKeys.map((key) => {
    const rows = groups.get(key) ?? [];
    const seen = new Set<string>();
    const workers: { name: string; type: WorkerType }[] = [];
    const exceptions: DailyReportException[] = [];
    for (const r of rows) {
      if (!seen.has(r.workerId)) {
        seen.add(r.workerId);
        workers.push({ name: r.workerName, type: r.workerType });
      }
      if (r.exception) exceptions.push(r.exception);
    }
    const wp = key ? wpById.get(key) : undefined;
    return {
      wpId: key,
      wpCode: wp?.deliverableCode ?? null,
      title: wp?.name ?? GENERAL_TITLE,
      headcount: seen.size,
      workers,
      exceptions,
    };
  });

  // Distinct workers across the whole day for the totals.
  const distinct = new Map<string, WorkerType>();
  for (const r of labor) if (!distinct.has(r.workerId)) distinct.set(r.workerId, r.workerType);
  const headcountByType = { company: 0, dc: 0, subcon: 0 };
  for (const type of distinct.values()) headcountByType[type] += 1;

  const lateWorkers = new Set<string>();
  const otWorkers = new Set<string>();
  for (const r of labor) {
    if (r.exception?.kind === "late") lateWorkers.add(r.workerId);
    else if (r.exception?.kind === "ot") otWorkers.add(r.workerId);
  }

  return {
    entries,
    headcountByType,
    lateCount: lateWorkers.size,
    otCount: otWorkers.size,
    totalHeadcount: distinct.size,
  };
}
