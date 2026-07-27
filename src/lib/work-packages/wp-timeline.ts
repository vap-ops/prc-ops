import { bangkokDateOf } from "@/lib/dates";

// Spec 363 U2b — the ประวัติ timeline's pure builder.
//
// One shape for every event so the tab is a single rail, and so the spec-363 D3
// plan lane is an added `kind` later rather than a rebuild. The builder is pure:
// the loader hands it raw rows, it returns day-grouped display rows. Nothing here
// touches the DB, so every rule that could be wrong is unit-testable.
//
// Spec 363 U2a — status transitions ARE a source now, supplied by the
// `wp_status_history` DEFINER RPC. They are NOT read from audit_log directly:
// its site-staff policy is an EVENT ALLOWLIST admitting only
// `wp_reopened_for_defect` and `wp_evidence_resubmitted` (§4.1), so a site admin
// cannot see `wp_status_transition` (552 rows/30d) at all. The RPC scopes per
// call; the policy was deliberately NOT widened, because that arm has no project
// scoping and would leak every project's history to every SA.
//
// `statuses` is OPTIONAL: the RPC refuses plain `procurement` (can_see_project
// is structurally false for it), so the loader supplies nothing for that role and
// the rail must still build.

/** Every event kind the rail can render. `plan` is reserved for spec 363 D3 and renders nothing yet. */
export type WpTimelineKind =
  | "photos"
  | "decision"
  | "request"
  | "issue"
  | "return"
  | "rework"
  | "status"
  | "plan";

/** The four filter chips: ทั้งหมด is the absence of a filter, so it is not a value here. */
export type WpTimelineFilter = "photos" | "review" | "materials" | "status";

interface RowBase {
  /** ISO stamp the row sorts on. For a collapsed burst, the FIRST capture. */
  at: string;
  actor: string | null;
  /** Unique across kinds — a photo and a stock issue may share a source id. */
  key: string;
}

export type WpTimelineRow =
  | (RowBase & { kind: "photos"; phase: string; count: number; until: string })
  | (RowBase & {
      kind: "decision";
      decision: string;
      reason: string | null;
      comment: string | null;
    })
  | (RowBase & {
      kind: "request";
      prNumber: string;
      item: string;
      qty: number;
      unit: string;
      status: string;
    })
  | (RowBase & { kind: "issue"; item: string; qty: number; unit: string })
  | (RowBase & { kind: "return"; item: string; qty: number; unit: string })
  | (RowBase & { kind: "rework"; event: string })
  | (RowBase & { kind: "status"; from: string | null; to: string | null; round: number | null })
  | (RowBase & { kind: "plan"; label: string });

export interface WpTimelineDay {
  /** Bangkok calendar date, `YYYY-MM-DD`. */
  date: string;
  rows: WpTimelineRow[];
}

export interface WpTimelineStatusRow {
  at: string;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  rework_round: number | null;
}

export interface WpTimelineInput {
  photos: { id: string; phase: string; created_at: string; uploaded_by: string | null }[];
  approvals: {
    id: string;
    decision: string;
    revision_reason: string | null;
    comment: string | null;
    decided_at: string;
    decided_by: string;
  }[];
  requests: {
    id: string;
    pr_number: string;
    item_description: string;
    quantity: number;
    unit: string;
    status: string;
    requested_at: string;
    requested_by: string | null;
  }[];
  issues: {
    id: string;
    item: string;
    qty: number;
    unit: string;
    issued_at: string;
    issued_by: string | null;
  }[];
  returns: {
    id: string;
    item: string;
    qty: number;
    unit: string;
    returned_at: string;
    returned_by: string | null;
  }[];
  reworkEvents: { id: string; event: string; created_at: string; actor_id: string | null }[];
  /** Spec 363 U2a — from wp_status_history. Optional: the RPC refuses roles that
   *  can_see_project rejects, so a permitted VIEWER may still have no rows. */
  statuses?: WpTimelineStatusRow[] | undefined;
  /** user id → display name. Missing ids render as an unattributed row, never a raw uuid. */
  names: Record<string, string>;
}

/**
 * Which chip a kind belongs to. `materials` deliberately covers request · issue ·
 * return: to a site admin those are one question — what materials touched this WP —
 * and splitting them into three chips would rebuild the tab sprawl spec 363 removed.
 */
export function timelineFilterOf(kind: WpTimelineKind): WpTimelineFilter | null {
  switch (kind) {
    case "photos":
      return "photos";
    case "decision":
      return "review";
    case "request":
    case "issue":
    case "return":
      return "materials";
    case "rework":
    case "status":
      return "status";
    case "plan":
      // Spec 363 D3: the plan lane exists in the model and renders nothing.
      return null;
  }
}

function nameOf(names: Record<string, string>, id: string | null): string | null {
  return id ? (names[id] ?? null) : null;
}

/** Collapse photos to one row per (Bangkok day, phase) with a count and a time span. */
function photoRows(input: WpTimelineInput): WpTimelineRow[] {
  const buckets = new Map<string, { phase: string; stamps: string[]; uploaders: Set<string> }>();
  for (const p of input.photos) {
    const key = `${bangkokDateOf(p.created_at)}|${p.phase}`;
    const bucket = buckets.get(key) ?? { phase: p.phase, stamps: [], uploaders: new Set<string>() };
    bucket.stamps.push(p.created_at);
    if (p.uploaded_by) bucket.uploaders.add(p.uploaded_by);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, b]) => {
    const stamps = [...b.stamps].sort();
    const only = b.uploaders.size === 1 ? [...b.uploaders][0]! : null;
    return {
      kind: "photos",
      key: `photos:${key}`,
      at: stamps[0]!,
      until: stamps[stamps.length - 1]!,
      phase: b.phase,
      count: stamps.length,
      // A burst shot by two people is attributed to neither rather than to whoever
      // happened to sort first.
      actor: nameOf(input.names, only),
    };
  });
}

/**
 * Build the rail: newest day first, newest row first inside each day.
 */
export function buildWpTimeline(input: WpTimelineInput): WpTimelineDay[] {
  const rows: WpTimelineRow[] = [
    ...photoRows(input),
    ...input.approvals.map(
      (a): WpTimelineRow => ({
        kind: "decision",
        key: `decision:${a.id}`,
        at: a.decided_at,
        actor: nameOf(input.names, a.decided_by),
        decision: a.decision,
        reason: a.revision_reason,
        comment: a.comment,
      }),
    ),
    ...input.requests.map(
      (r): WpTimelineRow => ({
        kind: "request",
        key: `request:${r.id}`,
        at: r.requested_at,
        actor: nameOf(input.names, r.requested_by),
        prNumber: r.pr_number,
        item: r.item_description,
        qty: r.quantity,
        unit: r.unit,
        status: r.status,
      }),
    ),
    ...input.issues.map(
      (i): WpTimelineRow => ({
        kind: "issue",
        key: `issue:${i.id}`,
        at: i.issued_at,
        actor: nameOf(input.names, i.issued_by),
        item: i.item,
        qty: i.qty,
        unit: i.unit,
      }),
    ),
    ...input.returns.map(
      (r): WpTimelineRow => ({
        kind: "return",
        key: `return:${r.id}`,
        at: r.returned_at,
        actor: nameOf(input.names, r.returned_by),
        item: r.item,
        qty: r.qty,
        unit: r.unit,
      }),
    ),
    ...input.reworkEvents.map(
      (e): WpTimelineRow => ({
        kind: "rework",
        key: `rework:${e.id}`,
        at: e.created_at,
        actor: nameOf(input.names, e.actor_id),
        event: e.event,
      }),
    ),
    // Optional: the RPC refuses roles can_see_project rejects, so the loader may
    // pass nothing and the rail must still build.
    ...(input.statuses ?? []).map(
      (t, i): WpTimelineRow => ({
        kind: "status",
        // audit_log rows carry no natural key here, and two transitions can share
        // a timestamp to the second, so the index keeps the React key unique.
        key: `status:${t.at}:${i}`,
        at: t.at,
        actor: nameOf(input.names, t.actor_id),
        from: t.from_status,
        to: t.to_status,
        round: t.rework_round,
      }),
    ),
  ];

  const days = new Map<string, WpTimelineRow[]>();
  for (const row of rows) {
    const date = bangkokDateOf(row.at);
    const bucket = days.get(date);
    if (bucket) bucket.push(row);
    else days.set(date, [row]);
  }

  return [...days.entries()]
    .map(([date, dayRows]) => ({
      date,
      rows: dayRows.sort((a, b) => b.at.localeCompare(a.at)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
