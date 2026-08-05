// Spec 392 U3a — the zone × หมวดงาน rollup on the project page (spec 392 §5).
// Pure display, server-safe (no hooks, no state); every number comes from
// buildZoneRollup so the arithmetic is tested where it lives.
//
// A GRID rather than a list because zone and work-category are independent axes
// (U1's whole premise): a WP carries exactly one หมวดงาน while a zone spans
// several, so neither dimension can answer for the other.
//
// It renders NOTHING when the project has no zones — which is every project
// today (`project_zones` is 0 rows in prod). An empty frame on the app's
// highest-traffic mobile route would cost every reader space to say nothing.

import {
  PROJECT_CATEGORY_LABEL,
  WORK_CATEGORY_UNSET_LABEL,
  ZONE_LABEL,
  ZONE_PROGRESS_LABEL,
  ZONE_ROLLUP_OWN_ONLY_NOTE,
  ZONE_UNSET_LABEL,
} from "@/lib/i18n/labels";
import type { RollupRow, ZoneRollup } from "@/lib/zones/zone-rollup";

// GEOMETRY ONLY — no colour. A shared constant that also set a colour would be
// overridden by the call sites that want a stronger ink, and which one wins is
// decided by the GENERATED stylesheet's order rather than by the className
// (ui-class-contracts, the 2026-07-26 bug class). Every cell spells out its own
// ink below.
const CELL = "text-meta px-3 py-2 text-right tabular-nums whitespace-nowrap";

function Row({ row, isRemainder }: { row: RollupRow; isRemainder: boolean }) {
  return (
    <tr className={isRemainder ? "border-edge bg-sunk border-t-2" : ""}>
      <th
        scope="row"
        className="text-body text-ink max-w-[12rem] truncate px-3 py-2 text-left font-medium"
        // The zone list indents a child under its parent; the grid keeps the
        // same shape so the two surfaces read as one ordering.
        style={isRemainder ? undefined : { paddingLeft: `${12 + row.depth * 16}px` }}
      >
        {isRemainder ? (
          ZONE_UNSET_LABEL
        ) : (
          <>
            <span className="text-ink-secondary mr-1.5 font-mono">{row.code}</span>
            {row.name}
          </>
        )}
      </th>
      {row.cells.map((count, i) => (
        <td key={i} className={`${CELL} text-ink-secondary`}>
          {count}
        </td>
      ))}
      {/* An empty zone has nothing to report, and "0%" is not that — it reads
          as "no progress" on work that does not exist. Until the assignment
          screen lands (U4) every drawn zone is empty, so this is the state the
          first PM to draw a map actually meets. */}
      <td className={`${CELL} text-ink font-semibold`}>{row.total === 0 ? "—" : row.total}</td>
      <td className={`${CELL} text-ink font-semibold`}>
        {row.total === 0 ? "—" : `${row.percent}%`}
      </td>
    </tr>
  );
}

export function ZoneRollupGrid({ rollup }: { rollup: ZoneRollup }) {
  if (rollup.rows.length === 0) return null;

  // A child row is INDENTED under its parent, which is a claim about position
  // in the tree — but a parent's numbers are its OWN directly-placed work, not
  // its subtree's, exactly as the zone list's counts already are. Left silent,
  // an indented `อาคาร A — 0 — 0%` above a full `A1` would read as "อาคาร A is
  // not started". Said out loud only when nesting actually exists, so the flat
  // case (every project today, and the only one the editor can produce) carries
  // no extra copy. ⚑ Whether a parent SHOULD aggregate its children is a real
  // question and belongs with the assignment screen (U4) — recorded, not
  // invented here, because changing it would also change the zone list.
  const hasNesting = rollup.rows.some((row) => row.depth > 0);

  return (
    <section className="mb-4">
      <h2 className="text-section text-ink mb-2 font-semibold">{ZONE_PROGRESS_LABEL}</h2>
      {hasNesting ? (
        <p className="text-meta text-ink-secondary mb-2">{ZONE_ROLLUP_OWN_ONLY_NOTE}</p>
      ) : null}
      {/* The pan-x + pinch-zoom pair is mandatory beside overflow-x-auto
          (ui-class-contracts): a bare scroller hijacks vertical page scroll on
          touch, and pan-x alone silently kills pinch-zoom. */}
      <div className="rounded-card border-edge bg-card [touch-action:pan-x_pinch-zoom] overflow-x-auto border">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            {ZONE_PROGRESS_LABEL} — {ZONE_LABEL} × {PROJECT_CATEGORY_LABEL}
          </caption>
          <thead>
            <tr className="border-edge bg-sunk border-b">
              <th scope="col" className="text-meta text-ink-secondary px-3 py-2 text-left">
                {ZONE_LABEL}
              </th>
              {rollup.columns.map((col) => (
                <th
                  key={col.id ?? "__uncategorised__"}
                  scope="col"
                  className="text-meta text-ink-secondary px-3 py-2 text-right whitespace-nowrap"
                >
                  {col.name ?? WORK_CATEGORY_UNSET_LABEL}
                </th>
              ))}
              <th scope="col" className="text-meta text-ink-secondary px-3 py-2 text-right">
                รวม
              </th>
              <th scope="col" className="text-meta text-ink-secondary px-3 py-2 text-right">
                เสร็จ
              </th>
            </tr>
          </thead>
          <tbody className="divide-edge divide-y">
            {rollup.rows.map((row) => (
              <Row key={row.zoneId} row={row} isRemainder={false} />
            ))}
            {/* The remainder is part of the table, not a footnote: the reader
                has to be able to see that most of the project is unplaced while
                the zones above show tidy percentages. */}
            {rollup.unzoned ? <Row row={rollup.unzoned} isRemainder /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
