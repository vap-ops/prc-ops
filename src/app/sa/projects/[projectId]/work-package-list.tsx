"use client";

// Client Component: text filter + hide-completed toggle + deliverable
// grouping over an already-loaded WP list. Spec locks the filter at ~80
// rows, so all filtering is in-memory (no server search, no debounce).
// Both filters compose: a WP is shown iff it matches the text query AND
// isn't hidden by the completed toggle.
//
// Spec 11 grouping: when the project has deliverables, WPs render under
// per-deliverable headers that toggle show/hide (collapsed by default —
// the landing view is the deliverable overview with counts). An active
// text query overrides collapse so matches are never hidden; groups
// emptied by the filters disappear (the pure helper never returns empty
// groups). With ZERO deliverables — today's live state until spec 04
// Phase 2 backfills — the list renders flat, exactly as before.
//
// "Hide completed" defaults OFF — nothing disappears unless the user
// asks. Collapse state, the toggle, and the text query are all local
// client state, so the URL stays stable and there's no server round-trip.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/db/database.types";
import {
  groupWorkPackagesByDeliverable,
  type GroupDeliverable,
} from "@/lib/deliverables/group-work-packages";
import { workPackageStatusPillClasses } from "@/lib/status-colors";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

const WP_STATUS_LABEL: Record<WorkPackageStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  on_hold: "On hold",
  complete: "Complete",
  pending_approval: "Pending approval",
};

const UNGROUPED_KEY = "__ungrouped__";

export interface WorkPackageListItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  deliverableId: string | null;
}

interface WorkPackageListProps {
  projectId: string;
  workPackages: ReadonlyArray<WorkPackageListItem>;
  deliverables: ReadonlyArray<GroupDeliverable>;
}

export function WorkPackageList({ projectId, workPackages, deliverables }: WorkPackageListProps) {
  const [query, setQuery] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);
  // Keys of groups the user has opened (deliverable id, or UNGROUPED_KEY).
  // Default empty = all collapsed.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workPackages.filter((wp) => {
      if (hideCompleted && wp.status === "complete") return false;
      if (!q) return true;
      return wp.code.toLowerCase().includes(q) || wp.name.toLowerCase().includes(q);
    });
  }, [query, workPackages, hideCompleted]);

  const groups = useMemo(
    () => groupWorkPackagesByDeliverable(filtered, deliverables),
    [filtered, deliverables],
  );

  const searching = query.trim().length > 0;

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Empty-state copy depends on what's actually empty: no WPs at all,
  // text filter zeroed the list, hide-completed zeroed the list, or
  // both combined zeroed it. The user gets the most specific message
  // that applies.
  const emptyMessage =
    workPackages.length === 0
      ? "No work packages yet."
      : hideCompleted && workPackages.every((wp) => wp.status === "complete")
        ? "All work packages are complete."
        : "No matching work packages.";

  const rowLink = (wp: WorkPackageListItem) => (
    <Link
      href={`/sa/projects/${projectId}/work-packages/${wp.id}`}
      className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
    >
      <div className="min-w-0">
        <p className="font-mono text-xs text-zinc-500">{wp.code}</p>
        <p className="truncate text-base font-medium text-zinc-100">{wp.name}</p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${workPackageStatusPillClasses(wp.status)}`}
      >
        {WP_STATUS_LABEL[wp.status] ?? wp.status}
      </span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="Filter by code or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-500 sm:flex-1"
          aria-label="Filter work packages"
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 select-none has-[input:checked]:border-zinc-600 has-[input:checked]:bg-zinc-800 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-zinc-500">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
            className="accent-zinc-100"
          />
          Hide completed
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-400">
          {emptyMessage}
        </p>
      ) : deliverables.length === 0 ? (
        // Degraded mode (spec 11): no deliverables on the project yet —
        // flat list, exactly the pre-grouping behaviour.
        <ul className="flex flex-col gap-2">
          {filtered.map((wp) => (
            <li key={wp.id}>{rowLink(wp)}</li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const key = group.deliverable?.id ?? UNGROUPED_KEY;
            const isOpen = searching || expanded.has(key);
            const completeCount = group.workPackages.filter(
              (wp) => wp.status === "complete",
            ).length;
            const contentId = `wp-group-${key}`;
            return (
              <section key={key} className="overflow-hidden rounded-lg border border-zinc-800">
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="flex min-h-12 w-full items-center gap-3 bg-zinc-900/80 px-4 py-3 text-left transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  <ChevronRight
                    aria-hidden
                    className={`size-4 shrink-0 text-zinc-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="min-w-0 flex-1">
                    {group.deliverable ? (
                      <>
                        <span className="font-mono text-xs text-zinc-500">
                          {group.deliverable.code}
                        </span>
                        <span className="block truncate text-sm font-medium text-zinc-100">
                          {group.deliverable.name}
                        </span>
                      </>
                    ) : (
                      <span className="block truncate text-sm font-medium text-zinc-400">
                        Ungrouped
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs text-zinc-500">
                    {group.workPackages.length} {group.workPackages.length === 1 ? "WP" : "WPs"}
                    {completeCount > 0 ? (
                      <span className="block text-emerald-400">{completeCount} complete</span>
                    ) : null}
                  </span>
                </button>
                {isOpen ? (
                  <ul id={contentId} className="flex flex-col gap-2 border-t border-zinc-800 p-2">
                    {group.workPackages.map((wp) => (
                      <li key={wp.id}>{rowLink(wp)}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
