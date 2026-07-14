// Spec 306 U1 — badge card builder. Pure shaping for the printable QR badge
// sheet: RLS-read workers + the service-role employee_id map + the SA's project
// list → per-project badge groups. The QR payload is the worker id (opaque —
// a scan only means something inside an authenticated SA session, spec 306);
// the PRC code is the human fallback when a QR won't read, null when unset.

export interface BadgeProject {
  id: string;
  code: string;
  name: string;
}

export interface BadgeWorkerRow {
  id: string;
  name: string;
  project_id: string | null;
}

export interface BadgeCard {
  workerId: string;
  name: string;
  code: string | null;
}

export interface BadgeGroup {
  project: BadgeProject;
  badges: BadgeCard[];
}

export function buildBadgeGroups(
  workers: ReadonlyArray<BadgeWorkerRow>,
  codeByWorkerId: ReadonlyMap<string, string>,
  projects: ReadonlyArray<BadgeProject>,
  onlyWorkerId?: string,
): BadgeGroup[] {
  const groups: BadgeGroup[] = [];
  for (const project of projects) {
    const badges = workers
      .filter(
        (w) => w.project_id === project.id && (onlyWorkerId === undefined || w.id === onlyWorkerId),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "th"))
      .map((w) => ({
        workerId: w.id,
        name: w.name,
        code: codeByWorkerId.get(w.id) ?? null,
      }));
    if (badges.length > 0) groups.push({ project, badges });
  }
  return groups;
}
