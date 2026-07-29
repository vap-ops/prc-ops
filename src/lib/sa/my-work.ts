// Spec 192 U4 — view-model for the site-admin daily home's "งานของฉัน" list. The
// page reads the SA's visible, not-done work packages (RLS scopes them to the
// SA's member projects, can_see_wp / ADR 0056) + their projects; this joins +
// sorts them. Pure so it's unit-testable; WP-centric (the WP is the unit of daily
// work the SA acts on).
//
// Spec 277 P0 — also resolves each WP's category_id (a project_category id) to its
// reconciled GLOBAL work-category code (W0x) via categoryCodeById, so the card can
// render the category letter·color·icon (WP-12 → E-12). Uncategorised → null.

import type { WorkPackageStatus } from "@/lib/db/enums";

export interface MyWorkWp {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  project_id: string;
  /** project_categories id (spec 207), or null when uncategorised. */
  category_id: string | null;
  /** Spec 375 U1 — the movement tie-break for a WP that has no photo yet. */
  updated_at: string;
}

/**
 * Spec 375 U1 — a WP with no photo in this many days renders below the rule.
 * 14 days matches the telemetry window the unit was measured against.
 */
export const COLD_PHOTO_DAYS = 14;

/**
 * How far back the page reads photo rows. Only the HOT ordering has to be exact;
 * anything with no photo in this window is cold regardless, and orders by
 * `updated_at`. Bounds a read that would otherwise grow with project life — the
 * whole table is 2,704 rows today but only 272 fall in this window for the WPs
 * this list renders. MUST stay > COLD_PHOTO_DAYS or the rule would mislabel rows
 * whose only photo fell between the two windows.
 */
export const PHOTO_WINDOW_DAYS = 30;

/** ISO cutoff for `MovementInput.coldBeforeIso`, `days` before `nowMs`. Pure. */
export function coldCutoffIso(nowMs: number, days: number = COLD_PHOTO_DAYS): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The same cutoff against the current clock. Separate from `coldCutoffIso` so the
 * ordering stays a pure, testable function of an injected `nowMs`, while the page
 * keeps the clock read OUT of its render body — the React Compiler lint rejects an
 * impure call there ("Cannot call impure function during render").
 */
export function coldCutoffFromNow(days: number = COLD_PHOTO_DAYS): string {
  return coldCutoffIso(Date.now(), days);
}

/**
 * Spec 375 U1 — the movement inputs. Optional so every pre-existing caller keeps
 * the legacy alphabetical contract unchanged.
 */
export interface MovementInput {
  /** wpId → ISO timestamp of its most recent REAL photo (tombstones excluded). */
  lastPhotoByWp: ReadonlyMap<string, string>;
  /** A WP whose last photo predates this — or which has none — renders cold. */
  coldBeforeIso: string;
}

export interface MyWorkItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  projectId: string;
  projectName: string;
  projectCode: string;
  /** Reconciled GLOBAL work-category code (W0x), or null if uncategorised. */
  categoryCode: string | null;
  /** Spec 375 U1 — ISO timestamp of the most recent real photo, or null. */
  lastPhotoAt: string | null;
  /** Spec 375 U1 — below the `ไม่มีรูปใน N วัน` rule. Always false without movement input. */
  isCold: boolean;
}

export function buildMyWorkList(
  rows: ReadonlyArray<MyWorkWp>,
  projectsById: ReadonlyMap<string, { code: string; name: string }>,
  categoryCodeById: ReadonlyMap<string, string> = new Map(),
  movement?: MovementInput,
): MyWorkItem[] {
  return rows
    .map((r) => {
      const project = projectsById.get(r.project_id);
      const lastPhotoAt = movement?.lastPhotoByWp.get(r.id) ?? null;
      // ⚠️ Compare INSTANTS, never the raw strings. The two sources are encoded
      // differently — PostgREST returns `…+00:00` while `toISOString()` (the cold
      // cutoff) returns `…Z`, and `"+" < "Z"` bytewise — so a lexicographic
      // compare of a photo timestamp against the cutoff is only accidentally
      // right, and wrong at the boundary. Parsing once here also keeps the
      // comparator O(1) per call instead of re-parsing inside the sort.
      const lastPhotoMs = lastPhotoAt === null ? null : Date.parse(lastPhotoAt);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        status: r.status,
        projectId: r.project_id,
        projectName: project?.name ?? "—",
        projectCode: project?.code ?? "",
        categoryCode: (r.category_id && categoryCodeById.get(r.category_id)) || null,
        lastPhotoAt,
        // No movement input → the legacy alphabetical list, nothing marked cold.
        isCold: movement
          ? lastPhotoMs === null || lastPhotoMs < Date.parse(movement.coldBeforeIso)
          : false,
        lastPhotoMs,
        updatedMs: Date.parse(r.updated_at),
      };
    })
    .sort((a, b) => {
      if (movement) {
        // Photographed WPs first, newest photo first; a WP with no photo sinks
        // below every WP that has one. This ordering is what makes the cold set a
        // contiguous TAIL, which is the precondition for rendering the
        // `ไม่มีรูปใน N วัน` rule as a single divider rather than a repeated chip.
        if (a.lastPhotoMs !== b.lastPhotoMs) {
          if (a.lastPhotoMs === null) return 1;
          if (b.lastPhotoMs === null) return -1;
          return b.lastPhotoMs - a.lastPhotoMs;
        }
        // Same photo recency (or both unphotographed) → whichever the app touched
        // most recently. Catches a WP moved through labor or a purchase request.
        if (a.updatedMs !== b.updatedMs) return b.updatedMs - a.updatedMs;
      }
      // Final stable tie-break — the pre-spec-375 order, preserved so the list
      // never reshuffles between renders for rows with identical movement.
      return a.projectCode.localeCompare(b.projectCode) || a.code.localeCompare(b.code);
    })
    .map(({ lastPhotoMs: _lastPhotoMs, updatedMs: _updatedMs, ...item }) => item);
}
