"use client";

// Client Component: the Field-First worklist. Two LENSES over an
// already-loaded WP list (~80 rows, all in-memory):
//
//   • action  — "what needs MY action now?" WPs grouped into action
//     bands (ต้องทำเลย / พักงาน / รอ PM ตรวจ / เสร็จแล้ว). The ต้องทำ band is
//     ordered by the supplied universal priorityRank, so every role sees
//     the highest-leverage work first. Default lens for site_admin.
//
//   • deliverable — งวดงาน grouping with progress headers (the PM's
//     billing-oriented overview). Default lens for project_manager /
//     super_admin. The lens is one tap away for both roles.
//
// Replaces the spec-56 four-view segmented control: the action lens IS
// the filter now, and finished WPs collapse into a summary by default
// (spec-56 intent: hide finished, show on request).
//
// priority / priorityRank / isCritical are SUPPLIED props (a separate
// priority-engine spec owns derivation + migration). This component only
// consumes and orders. Lens + collapse state are local; the URL stays
// stable, no server round-trip.

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { EmptyNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { WorklistRow, type WorklistRowItem } from "@/components/features/chrome/worklist-row";
import type { Database } from "@/lib/db/database.types";
import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";
import {
  groupWorkPackagesByDeliverable,
  type GroupDeliverable,
} from "@/lib/deliverables/group-work-packages";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import {
  ACTION_BAND_META,
  deriveActionBand,
  groupByActionBand,
  type ActionBand,
  type WorkPackageStatus,
  type WpPriority,
} from "@/lib/work-packages/action-bands";

type UserRole = Database["public"]["Enums"]["user_role"];

const UNGROUPED_KEY = "__ungrouped__";

export interface WorkPackageListItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  deliverableId: string | null;
  /** Whether a contractor is assigned — drives the row's next-action verb. */
  hasContractor: boolean;
  /** Supplied props (priority-engine spec). Safe defaults at the page. */
  priority: WpPriority;
  priorityRank: number;
  isCritical: boolean;
}

type Lens = "action" | "deliverable";

interface WorkPackageListProps {
  projectId: string;
  role: UserRole;
  workPackages: ReadonlyArray<WorkPackageListItem>;
  deliverables: ReadonlyArray<GroupDeliverable>;
}

/** Role decides the default lens; both lenses stay one tap away. */
function defaultLens(role: UserRole): Lens {
  return role === "site_admin" ? "action" : "deliverable";
}

export function WorkPackageList({
  projectId,
  role,
  workPackages,
  deliverables,
}: WorkPackageListProps) {
  const [lens, setLens] = useState<Lens>(() => defaultLens(role));
  // Action lens: which triage band is filtered (null = all bands).
  const [bandFilter, setBandFilter] = useState<ActionBand | null>(null);
  // Action lens: the done band is collapsed until asked for.
  const [showDone, setShowDone] = useState(false);
  // Deliverable lens: opened group keys (empty = all collapsed).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const deliverableNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deliverables) map.set(d.id, d.code);
    return map;
  }, [deliverables]);

  function toRowItem(wp: WorkPackageListItem): WorklistRowItem {
    return {
      id: wp.id,
      code: wp.code,
      name: wp.name,
      status: wp.status,
      hasContractor: wp.hasContractor,
      priority: wp.priority,
      isCritical: wp.isCritical,
      deliverableLabel: wp.deliverableId
        ? (deliverableNameById.get(wp.deliverableId) ?? null)
        : null,
    };
  }

  // ---- action-lens derivation ------------------------------------------
  const bands = useMemo(() => groupByActionBand(workPackages), [workPackages]);
  const countByBand = useMemo(() => {
    const m: Record<ActionBand, number> = { todo: 0, held: 0, review: 0, done: 0 };
    for (const wp of workPackages) m[deriveActionBand(wp.status)] += 1;
    return m;
  }, [workPackages]);

  if (workPackages.length === 0) {
    return <EmptyNotice>ยังไม่มีรายการงาน</EmptyNotice>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Lens toggle — segmented, 44px. Action = สถานะ, deliverable = งวดงาน. */}
      <div
        role="radiogroup"
        aria-label="มุมมองรายการงาน"
        className="rounded-control border-edge bg-sunk flex gap-1 border p-1"
      >
        {(
          [
            { value: "action", label: "ตามสถานะ" },
            { value: "deliverable", label: "ตามงวดงาน" },
          ] as const
        ).map((opt) => {
          const on = lens === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setLens(opt.value)}
              className={`text-body focus-visible:ring-action min-h-11 flex-1 rounded-[0.625rem] font-bold transition-colors focus:outline-none focus-visible:ring-2 ${
                on ? "bg-card text-ink shadow-card" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {lens === "action" ? (
        <ActionLens
          projectId={projectId}
          bands={bands}
          countByBand={countByBand}
          bandFilter={bandFilter}
          onBandFilter={setBandFilter}
          showDone={showDone}
          onToggleDone={() => setShowDone((v) => !v)}
          toRowItem={toRowItem}
        />
      ) : (
        <DeliverableLens
          projectId={projectId}
          workPackages={workPackages}
          deliverables={deliverables}
          expanded={expanded}
          onToggle={(key) =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          toRowItem={toRowItem}
        />
      )}
    </div>
  );
}

// ======================================================================
// ACTION LENS — triage summary + priority-ranked bands
// ======================================================================
interface ActionLensProps {
  projectId: string;
  bands: Array<{ band: ActionBand; items: WorkPackageListItem[] }>;
  countByBand: Record<ActionBand, number>;
  bandFilter: ActionBand | null;
  onBandFilter: (b: ActionBand | null) => void;
  showDone: boolean;
  onToggleDone: () => void;
  toRowItem: (wp: WorkPackageListItem) => WorklistRowItem;
}

function ActionLens({
  projectId,
  bands,
  countByBand,
  bandFilter,
  onBandFilter,
  showDone,
  onToggleDone,
  toRowItem,
}: ActionLensProps) {
  // The three triage tiles the operator named. Tapping filters to that
  // band; tapping the active tile clears the filter.
  const tiles: Array<{ band: ActionBand; label: string }> = [
    { band: "todo", label: "ต้องทำ" },
    { band: "review", label: "รอตรวจ" },
    { band: "done", label: "เสร็จแล้ว" },
  ];

  const visibleBands = bands.filter((b) => {
    if (bandFilter) return b.band === bandFilter;
    if (b.band === "done") return showDone;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Triage summary — big tappable filters, hi-vis for the hot band. */}
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(({ band, label }) => {
          const active = bandFilter === band;
          const hot = band === "todo";
          return (
            <button
              key={band}
              type="button"
              aria-pressed={active}
              onClick={() => onBandFilter(active ? null : band)}
              className={`rounded-card focus-visible:ring-action flex min-h-[68px] flex-col items-start justify-center border-[1.5px] px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 ${
                hot ? "border-attn-press bg-attn text-on-attn" : "border-edge bg-card text-ink"
              } ${active ? "ring-action ring-2 ring-offset-1" : ""}`}
            >
              <span className="text-2xl leading-none font-extrabold">{countByBand[band]}</span>
              <span className="text-meta mt-1 font-bold">{label}</span>
            </button>
          );
        })}
      </div>

      {visibleBands.length === 0 ? (
        <EmptyNotice>
          {bandFilter
            ? "ไม่มีงานในสถานะนี้"
            : "ไม่มีงานที่ต้องทำ — แตะ “เสร็จแล้ว” เพื่อดูงานที่จบแล้ว"}
        </EmptyNotice>
      ) : (
        visibleBands.map(({ band, items }) => {
          const meta = ACTION_BAND_META[band];
          const isDone = band === "done";
          return (
            <section key={band} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 px-0.5">
                <span className={`h-3 w-3 rounded-full ${meta.spine}`} aria-hidden="true" />
                <h3 className="text-section text-ink font-extrabold">{meta.label}</h3>
                <span
                  className={`text-meta text-on-fill inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold ${meta.countBg}`}
                >
                  {items.length}
                </span>
              </div>
              {(isDone && bandFilter === null && !showDone ? [] : items).map((wp, i) => (
                <WorklistRow
                  key={wp.id}
                  projectId={projectId}
                  wp={toRowItem(wp)}
                  spine={meta.spine}
                  compact={band === "review" || band === "done"}
                  enterIndex={i}
                />
              ))}
            </section>
          );
        })
      )}

      {/* Done band lives behind one tap when not filtered. */}
      {bandFilter === null && countByBand.done > 0 && !showDone ? (
        <button
          type="button"
          onClick={onToggleDone}
          className="rounded-card border-done bg-done-soft text-body text-done-strong focus-visible:ring-action flex items-center justify-between gap-3 border px-4 py-3 font-bold transition-colors hover:brightness-[0.98] focus:outline-none focus-visible:ring-2"
        >
          <span className="flex items-center gap-2">
            <span className="bg-done-strong text-on-fill inline-flex h-6 w-6 items-center justify-center rounded-full">
              ✓
            </span>
            เสร็จแล้ว {countByBand.done} รายการ
          </span>
          <ChevronRight aria-hidden className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}

// ======================================================================
// DELIVERABLE LENS — งวดงาน grouping (PM overview), re-skinned
// ======================================================================
interface DeliverableLensProps {
  projectId: string;
  workPackages: ReadonlyArray<WorkPackageListItem>;
  deliverables: ReadonlyArray<GroupDeliverable>;
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  toRowItem: (wp: WorkPackageListItem) => WorklistRowItem;
}

function DeliverableLens({
  projectId,
  workPackages,
  deliverables,
  expanded,
  onToggle,
  toRowItem,
}: DeliverableLensProps) {
  // Degraded (no-deliverables) flat list: finished WPs stay hidden until
  // asked for, same spec-56 intent the action lens honors.
  const [showDoneDegraded, setShowDoneDegraded] = useState(false);
  const groups = useMemo(
    () => groupWorkPackagesByDeliverable(workPackages, deliverables),
    [workPackages, deliverables],
  );

  // Header progress derives from the FULL membership (spec 12).
  const progressByKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveDeliverableProgress>>();
    for (const group of groups) {
      map.set(
        group.deliverable?.id ?? UNGROUPED_KEY,
        deriveDeliverableProgress(group.workPackages.map((wp) => wp.status)),
      );
    }
    return map;
  }, [groups]);

  if (deliverables.length === 0) {
    // Degraded mode (spec 11): no deliverables yet — flat priority list.
    // Spec 56: finished WPs collapse behind one tap (as the action lens does),
    // so a PM/super landing here doesn't get a wall of completed work.
    const outstanding = workPackages.filter((wp) => deriveActionBand(wp.status) !== "done");
    const doneCount = workPackages.length - outstanding.length;
    const rows = showDoneDegraded ? workPackages : outstanding;
    return (
      <div className="flex flex-col gap-2.5">
        {rows.length === 0 ? (
          <EmptyNotice>ไม่มีงานที่ต้องทำ — แตะ “เสร็จแล้ว” เพื่อดูงานที่จบแล้ว</EmptyNotice>
        ) : (
          rows.map((wp, i) => (
            <WorklistRow
              key={wp.id}
              projectId={projectId}
              wp={toRowItem(wp)}
              spine={ACTION_BAND_META[deriveActionBand(wp.status)].spine}
              enterIndex={i}
            />
          ))
        )}
        {doneCount > 0 && !showDoneDegraded ? (
          <button
            type="button"
            onClick={() => setShowDoneDegraded(true)}
            className="rounded-card border-done bg-done-soft text-body text-done-strong focus-visible:ring-action flex items-center justify-between gap-3 border px-4 py-3 font-bold transition-colors hover:brightness-[0.98] focus:outline-none focus-visible:ring-2"
          >
            <span className="flex items-center gap-2">
              <span className="bg-done-strong text-on-fill inline-flex h-6 w-6 items-center justify-center rounded-full">
                ✓
              </span>
              เสร็จแล้ว {doneCount} รายการ
            </span>
            <ChevronRight aria-hidden className="h-5 w-5" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const key = group.deliverable?.id ?? UNGROUPED_KEY;
        const isOpen = expanded.has(key);
        const progress =
          progressByKey.get(key) ??
          deriveDeliverableProgress(group.workPackages.map((wp) => wp.status));
        const groupName = group.deliverable?.name ?? "ยังไม่จัดกลุ่ม";
        const contentId = `wp-group-${key}`;
        return (
          <section
            key={key}
            className="rounded-card border-edge bg-card shadow-card overflow-hidden border"
          >
            <button
              type="button"
              onClick={() => onToggle(key)}
              aria-expanded={isOpen}
              aria-controls={contentId}
              className="border-attn bg-sunk focus-visible:ring-action flex min-h-12 w-full cursor-pointer flex-col gap-2 border-l-4 px-4 py-3 text-left transition-colors hover:brightness-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <span className="flex w-full items-center gap-3">
                <ChevronRight
                  aria-hidden
                  className={`text-ink-secondary size-4 shrink-0 transition-transform motion-reduce:transition-none ${
                    isOpen ? "rotate-90" : ""
                  }`}
                />
                <span className="min-w-0 flex-1">
                  {group.deliverable ? (
                    <>
                      <span className="text-meta text-ink-secondary font-mono font-semibold">
                        {group.deliverable.code}
                      </span>
                      <span className="text-heading text-ink line-clamp-2 block font-bold tracking-tight break-words">
                        {group.deliverable.name}
                      </span>
                    </>
                  ) : (
                    <span className="text-body text-ink-secondary line-clamp-2 block font-semibold break-words">
                      ยังไม่จัดกลุ่ม
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill pillClasses={workPackageStatusPillClasses(progress.status)}>
                    {WORK_PACKAGE_STATUS_LABEL[progress.status]}
                  </StatusPill>
                  <span className="text-meta text-ink-secondary">
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
                className="bg-edge block h-1.5 w-full overflow-hidden rounded-full"
              >
                <span
                  className="bg-done block h-full rounded-full transition-[width] motion-reduce:transition-none"
                  style={{ width: `${progress.percent}%` }}
                />
              </span>
            </button>
            {isOpen ? (
              <ul id={contentId} className="border-edge flex flex-col gap-2.5 border-t p-3">
                {group.workPackages.map((wp, i) => (
                  <li key={wp.id}>
                    <WorklistRow
                      projectId={projectId}
                      wp={toRowItem(wp as WorkPackageListItem)}
                      spine={ACTION_BAND_META[deriveActionBand(wp.status)].spine}
                      compact
                      enterIndex={i}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
