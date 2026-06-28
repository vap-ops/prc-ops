// Feedback 1d648880 — the projects-hub view layer: hide archived by default,
// filter by status, sort, and count per status. Pure (no I/O) so it's unit-
// tested; the page (Server Component) parses the URL params, the RLS-scoped
// loader hands it the visible rows, and ProjectsFilterBar renders the chips +
// sort links built here. Mirrors the procurement worklist chip pattern
// (server-safe deep links, live counts) — see worklist-status-chips.ts.

import type { Database } from "@/lib/db/database.types";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";

export type ProjectStatus = Database["public"]["Enums"]["project_status"];

/** The minimum a row needs to be filtered/sorted/counted. Real hub rows carry
 *  more (id, client_id, …); viewProjects is generic so it returns them intact. */
export interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  created_at: string;
}

// "all" = the default working set = everything EXCEPT archived (the operator's
// ask: archived projects must not show by default). archived is reachable only
// via its own chip.
export const PROJECT_STATUS_FILTERS = [
  "all",
  "active",
  "on_hold",
  "completed",
  "archived",
] as const;
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number];

export const PROJECT_SORTS = ["code", "name", "newest"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

/** An unknown/absent URL value falls back to the default (so a hand-edited URL
 *  never breaks the page). */
export function parseProjectStatusFilter(value: string | undefined): ProjectStatusFilter {
  return (PROJECT_STATUS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as ProjectStatusFilter)
    : "all";
}

export function parseProjectSort(value: string | undefined): ProjectSort {
  return (PROJECT_SORTS as readonly string[]).includes(value ?? "")
    ? (value as ProjectSort)
    : "code";
}

export interface ProjectStatusCounts {
  /** Non-archived working set — the "ทั้งหมด" chip. */
  all: number;
  active: number;
  on_hold: number;
  completed: number;
  archived: number;
}

export interface ProjectListView<T> {
  rows: T[];
  counts: ProjectStatusCounts;
}

export function viewProjects<T extends ProjectListItem>(
  projects: ReadonlyArray<T>,
  opts: { status: ProjectStatusFilter; sort: ProjectSort },
): ProjectListView<T> {
  const counts: ProjectStatusCounts = { all: 0, active: 0, on_hold: 0, completed: 0, archived: 0 };
  for (const p of projects) {
    counts[p.status] += 1;
    if (p.status !== "archived") counts.all += 1;
  }

  const filtered = projects.filter((p) =>
    opts.status === "all" ? p.status !== "archived" : p.status === opts.status,
  );
  const rows = [...filtered].sort((a, b) => compareProjects(a, b, opts.sort));
  return { rows, counts };
}

function compareProjects(a: ProjectListItem, b: ProjectListItem, sort: ProjectSort): number {
  if (sort === "name") {
    return a.name.localeCompare(b.name, "th") || a.code.localeCompare(b.code);
  }
  if (sort === "newest") {
    // created_at descending; code tiebreak keeps it deterministic.
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.code.localeCompare(b.code);
  }
  return a.code.localeCompare(b.code); // default: code ascending
}

// Clean, deep-linkable URLs: omit a param when it equals its default (status=all
// / sort=code) so the canonical hub URL stays "/projects".
function projectListHref(status: ProjectStatusFilter, sort: ProjectSort): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (sort !== "code") params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/projects?${qs}` : "/projects";
}

export interface ProjectStatusChip {
  key: ProjectStatusFilter;
  label: string;
  count: number;
  href: string;
  active: boolean;
}

export function buildProjectStatusChips(input: {
  counts: ProjectStatusCounts;
  status: ProjectStatusFilter;
  sort: ProjectSort;
}): ProjectStatusChip[] {
  const { counts, status, sort } = input;
  const defs: ReadonlyArray<{ key: ProjectStatusFilter; label: string; count: number }> = [
    { key: "all", label: "ทั้งหมด", count: counts.all },
    { key: "active", label: PROJECT_STATUS_LABEL.active, count: counts.active },
    { key: "on_hold", label: PROJECT_STATUS_LABEL.on_hold, count: counts.on_hold },
    { key: "completed", label: PROJECT_STATUS_LABEL.completed, count: counts.completed },
    { key: "archived", label: PROJECT_STATUS_LABEL.archived, count: counts.archived },
  ];
  return defs.map((d) => ({
    ...d,
    href: projectListHref(d.key, sort),
    active: status === d.key,
  }));
}

export interface ProjectSortOption {
  key: ProjectSort;
  label: string;
  href: string;
  active: boolean;
}

const SORT_LABEL: Record<ProjectSort, string> = {
  code: "รหัส",
  name: "ชื่อ",
  newest: "ล่าสุด",
};

export function buildProjectSortControls(input: {
  status: ProjectStatusFilter;
  sort: ProjectSort;
}): ProjectSortOption[] {
  const { status, sort } = input;
  return PROJECT_SORTS.map((key) => ({
    key,
    label: SORT_LABEL[key],
    href: projectListHref(status, key),
    active: sort === key,
  }));
}
