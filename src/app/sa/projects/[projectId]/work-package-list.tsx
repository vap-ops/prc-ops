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
import { EmptyNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/db/database.types";
import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";
import {
  groupWorkPackagesByDeliverable,
  type GroupDeliverable,
} from "@/lib/deliverables/group-work-packages";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

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

  // Header progress per group, derived from the UNFILTERED list (spec 12):
  // the pill, k/n count, and progress strip describe the deliverable's
  // true state even while query / hide-completed are hiding rows.
  const progressByKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveDeliverableProgress>>();
    for (const group of groupWorkPackagesByDeliverable(workPackages, deliverables)) {
      map.set(
        group.deliverable?.id ?? UNGROUPED_KEY,
        deriveDeliverableProgress(group.workPackages.map((wp) => wp.status)),
      );
    }
    return map;
  }, [workPackages, deliverables]);

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
      ? "ยังไม่มีรายการงาน"
      : hideCompleted && workPackages.every((wp) => wp.status === "complete")
        ? "รายการงานทั้งหมดเสร็จสิ้นแล้ว"
        : "ไม่พบรายการงานที่ตรงกับเงื่อนไข";

  // Two presentations (spec 40): a standalone card in flat mode, a
  // contained divided row inside a deliverable group — the visual
  // hierarchy the operator asked for (groups frame, rows belong).
  const rowLink = (wp: WorkPackageListItem, contained = false) => (
    <Link
      href={`/sa/projects/${projectId}/work-packages/${wp.id}`}
      className={
        contained
          ? "flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-inset"
          : "flex min-h-14 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
      }
    >
      <div className="min-w-0">
        <p className="font-mono text-xs text-zinc-600">{wp.code}</p>
        <p className="truncate text-base font-medium text-zinc-900">{wp.name}</p>
      </div>
      <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)}>
        {WORK_PACKAGE_STATUS_LABEL[wp.status] ?? wp.status}
      </StatusPill>
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="ค้นหาด้วยรหัสหรือชื่องาน…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 border-zinc-400 bg-white text-zinc-900 placeholder:text-zinc-400 sm:flex-1"
          aria-label="ค้นหารายการงาน"
        />
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700 shadow-xs select-none has-[input:checked]:border-slate-900 has-[input:checked]:bg-slate-900 has-[input:checked]:font-semibold has-[input:checked]:text-white has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-blue-700 has-[input:focus-visible]:ring-offset-2">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
            className="accent-slate-900"
          />
          ซ่อนงานที่เสร็จแล้ว
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyNotice>{emptyMessage}</EmptyNotice>
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
            // Progress is derived from the FULL membership (spec 12) so the
            // header tells the truth while the text filter or
            // "Hide completed" is hiding rows below it.
            const progress =
              progressByKey.get(key) ??
              deriveDeliverableProgress(group.workPackages.map((wp) => wp.status));
            const groupName = group.deliverable?.name ?? "ยังไม่จัดกลุ่ม";
            const contentId = `wp-group-${key}`;
            return (
              <section
                key={key}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="flex min-h-12 w-full cursor-pointer flex-col gap-2 border-l-4 border-amber-400 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-inset"
                >
                  <span className="flex w-full items-center gap-3">
                    <ChevronRight
                      aria-hidden
                      className={`size-4 shrink-0 text-zinc-600 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span className="min-w-0 flex-1">
                      {group.deliverable ? (
                        <>
                          <span className="font-mono text-xs font-semibold text-slate-500">
                            {group.deliverable.code}
                          </span>
                          <span className="block truncate text-base font-bold tracking-tight text-slate-900">
                            {group.deliverable.name}
                          </span>
                        </>
                      ) : (
                        <span className="block truncate text-sm font-medium text-zinc-600">
                          ยังไม่จัดกลุ่ม
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <StatusPill pillClasses={workPackageStatusPillClasses(progress.status)}>
                        {WORK_PACKAGE_STATUS_LABEL[progress.status]}
                      </StatusPill>
                      <span className="text-xs text-zinc-600">
                        {progress.completeCount}/{progress.totalCount} รายการ
                      </span>
                    </span>
                  </span>
                  <span
                    role="progressbar"
                    aria-valuenow={progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${groupName} — เสร็จแล้ว ${progress.percent}%`}
                    className="block h-1 w-full overflow-hidden rounded-full bg-zinc-200"
                  >
                    <span
                      className="block h-full rounded-full bg-emerald-600 transition-[width] motion-reduce:transition-none"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </span>
                </button>
                {isOpen ? (
                  <ul id={contentId} className="divide-y divide-zinc-100 border-t border-zinc-200">
                    {group.workPackages.map((wp) => (
                      <li key={wp.id}>{rowLink(wp, true)}</li>
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
