// Spec 277 P0 — the SA-home muster. Today's แผนวันนี้ carries the planned crew per
// งานย่อย with a present flag (already logged today); this folds it into the one-line
// "ทีมงานวันนี้ · X/Y มาทำ" summary shown above the plan. X/Y count UNIQUE workers so
// a person on two งานย่อย is one head, and `pending` groups the still-absent crew by
// WP so the muster's "ทั้งหมดมาทำ" logs them all through the existing log_labor_day.
// Pure (no fetch) so it's unit-testable; the /sa page supplies the rows.

export interface MusterCrew {
  workerId: string;
  present: boolean;
}

export interface MusterCrewGroup {
  workPackageId: string;
  crew: MusterCrew[];
}

export interface MusterSummary {
  /** Unique workers present on at least one of their assigned งานย่อย. */
  present: number;
  /** Unique workers planned across today's board. */
  total: number;
  /** Still-absent crew grouped by WP — the "ทั้งหมดมาทำ" one-tap targets. */
  pending: { workPackageId: string; workerIds: string[] }[];
}

export function summarizeMuster(items: ReadonlyArray<MusterCrewGroup>): MusterSummary {
  const all = new Set<string>();
  const present = new Set<string>();
  const pending: { workPackageId: string; workerIds: string[] }[] = [];

  for (const item of items) {
    const absent: string[] = [];
    for (const c of item.crew) {
      all.add(c.workerId);
      if (c.present) present.add(c.workerId);
      else absent.push(c.workerId);
    }
    if (absent.length > 0) pending.push({ workPackageId: item.workPackageId, workerIds: absent });
  }

  return { present: present.size, total: all.size, pending };
}
