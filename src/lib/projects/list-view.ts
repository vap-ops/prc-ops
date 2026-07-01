// Feedback 1d648880 — the projects-hub view layer: hide archived by default,
// filter by status, count per status. Feedback 7d9d2c2b (super_admin): "Add
// filtering by client. Remove all sorting — you can default sort, focus on
// filtering." So the sort control is gone (rows always default-sort by code) and
// a client facet sits beside the status facet. Pure (no I/O) so it's unit-tested;
// the page (Server Component) parses the URL params, the RLS-scoped loader hands
// it the visible rows + client names, and ProjectsFilterBar renders the chips.

import type { Database } from "@/lib/db/database.types";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import { displayName } from "@/lib/i18n/display-name";

export type ProjectStatus = Database["public"]["Enums"]["project_status"];

/** The minimum a row needs to be filtered/counted. Real hub rows carry more;
 *  viewProjects is generic so it returns them intact. */
export interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  client_id: string | null;
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

// Client facet sentinels: "all" (every client) and "none" (projects with no
// client). Any other value is a clients.id — safe to share this string space
// because clients.id is a uuid, never an operator-typed value.
export const PROJECT_CLIENT_ALL = "all";
export const PROJECT_CLIENT_NONE = "none";

/** An unknown/absent URL value falls back to the default (so a hand-edited URL
 *  never breaks the page). */
export function parseProjectStatusFilter(value: string | undefined): ProjectStatusFilter {
  return (PROJECT_STATUS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as ProjectStatusFilter)
    : "all";
}

/** The client filter is a free id (validated by presence in the chips, not here);
 *  a blank value means "all". */
export function parseProjectClientFilter(value: string | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? PROJECT_CLIENT_ALL : v;
}

/** Free-text project search (matches name OR code). Trimmed; blank = no search. */
export function parseProjectQuery(value: string | undefined): string {
  return (value ?? "").trim();
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
  /** Per-client project counts over the status-scoped set the rows are drawn
   *  from; keyed by client_id, with PROJECT_CLIENT_NONE for projects that have
   *  no client. */
  clientCounts: Map<string, number>;
}

export function viewProjects<T extends ProjectListItem>(
  projects: ReadonlyArray<T>,
  opts: { status: ProjectStatusFilter; client: string; query?: string },
): ProjectListView<T> {
  const counts: ProjectStatusCounts = { all: 0, active: 0, on_hold: 0, completed: 0, archived: 0 };
  for (const p of projects) {
    counts[p.status] += 1;
    if (p.status !== "archived") counts.all += 1;
  }

  // The set the rows are drawn from once the STATUS filter is applied (the client
  // filter not yet). The client facet is counted over THIS set, so its chips +
  // counts always match the rows being listed — including archived-only clients
  // when status=archived (a facet must never under-serve the view it sits above).
  const inStatus = projects.filter((p) =>
    opts.status === "all" ? p.status !== "archived" : p.status === opts.status,
  );
  const clientCounts = new Map<string, number>();
  for (const p of inStatus) {
    const key = p.client_id ?? PROJECT_CLIENT_NONE;
    clientCounts.set(key, (clientCounts.get(key) ?? 0) + 1);
  }

  // Free-text search narrows the ROWS only (not the facet counts) — it's an
  // orthogonal text filter layered on top of the status + client facets, so the
  // chip counts keep describing the faceted set the user can still navigate to.
  const q = (opts.query ?? "").trim().toLowerCase();
  const filtered = inStatus.filter((p) => {
    const clientOk =
      opts.client === PROJECT_CLIENT_ALL
        ? true
        : opts.client === PROJECT_CLIENT_NONE
          ? p.client_id === null
          : p.client_id === opts.client;
    if (!clientOk) return false;
    if (q === "") return true;
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
  });
  // Sorting control retired (feedback 7d9d2c2b) — always default to code ascending.
  const rows = [...filtered].sort((a, b) => a.code.localeCompare(b.code));
  return { rows, counts, clientCounts };
}

// Clean, deep-linkable URLs: omit a param when it equals its default (status=all
// / client=all / empty query) so the canonical hub URL stays "/projects".
export function projectListHref(status: ProjectStatusFilter, client: string, query = ""): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (client !== PROJECT_CLIENT_ALL) params.set("client", client);
  if (query.trim() !== "") params.set("q", query.trim());
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
  client: string;
  query?: string;
}): ProjectStatusChip[] {
  const { counts, status, client, query = "" } = input;
  const defs: ReadonlyArray<{ key: ProjectStatusFilter; label: string; count: number }> = [
    { key: "all", label: "ทั้งหมด", count: counts.all },
    { key: "active", label: PROJECT_STATUS_LABEL.active, count: counts.active },
    { key: "on_hold", label: PROJECT_STATUS_LABEL.on_hold, count: counts.on_hold },
    { key: "completed", label: PROJECT_STATUS_LABEL.completed, count: counts.completed },
    { key: "archived", label: PROJECT_STATUS_LABEL.archived, count: counts.archived },
  ];
  return defs.map((d) => ({
    ...d,
    href: projectListHref(d.key, client, query), // switching status keeps client + search
    active: status === d.key,
  }));
}

export interface ProjectClientChip {
  key: string;
  label: string;
  count: number;
  href: string;
  active: boolean;
}

export function buildProjectClientChips(input: {
  clientCounts: Map<string, number>;
  clientNames: ReadonlyMap<string, string>;
  status: ProjectStatusFilter;
  client: string;
  query?: string;
}): ProjectClientChip[] {
  const { clientCounts, clientNames, status, client, query = "" } = input;
  // The "ทั้งหมด" count is the facet total, so it always equals the row count of
  // the current status view (every project in the set falls in exactly one chip).
  const allCount = [...clientCounts.values()].reduce((sum, n) => sum + n, 0);

  // Named clients present in the working set, ordered by display name (Thai).
  const named = [...clientCounts.keys()]
    .filter((key) => key !== PROJECT_CLIENT_NONE)
    .map((key) => ({
      key,
      // Never leak the raw client id when the name can't be resolved (feedback
      // bc6df601 — procurement can't read `clients`, so the map misses the id).
      label: displayName(clientNames.get(key)),
      count: clientCounts.get(key) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));

  const chips: Array<{ key: string; label: string; count: number }> = [
    { key: PROJECT_CLIENT_ALL, label: "ทั้งหมด", count: allCount },
    ...named,
  ];
  // The no-client bucket only when some project actually has no client.
  const noneCount = clientCounts.get(PROJECT_CLIENT_NONE);
  if (noneCount !== undefined) {
    chips.push({ key: PROJECT_CLIENT_NONE, label: "ไม่ระบุลูกค้า", count: noneCount });
  }

  return chips.map((c) => ({
    ...c,
    href: projectListHref(status, c.key, query), // switching client keeps status + search
    active: client === c.key,
  }));
}
