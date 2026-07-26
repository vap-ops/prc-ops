// Spec 361 U4 — the ข้อมูลหลัก board: every reference list the firm keeps, one
// row each, grouped the way the operator named them. A curated list is a link;
// a list with no in-app editor yet renders as a plain row with its count and an
// explicit ยังแก้ไขในแอปไม่ได้ note, so the gap is visible instead of being a
// tile that opens nothing. Server component — no state, no I/O (page passes counts).
//
// Links carry ?from so a destination that reads it (safeBackHref) returns here.
// Not every destination does: /catalog/subcategories hardcodes back → /catalog
// today, so its chip lands one level short. Threading it there is a follow-up,
// not this unit's scope — the param is harmless where it is ignored.

import Link from "next/link";

import { withBackFrom } from "@/lib/nav/back-href";
import {
  MASTER_DATA_GROUPS,
  visibleMasterDataEntries,
  type MasterDataCounts,
  type MasterDataEntry,
} from "@/lib/purchasing/master-data";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";

export const MASTER_DATA_PENDING_NOTE = "ยังแก้ไขในแอปไม่ได้";

function EntryBody({ entry, count }: { entry: MasterDataEntry; count: number | null }) {
  return (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-ink font-semibold">{entry.label}</span>
        {count === null ? null : (
          <span className="text-ink-secondary text-meta tabular-nums">{count}</span>
        )}
      </span>
      <span className="text-ink-secondary text-meta mt-0.5 block">{entry.hint}</span>
      {entry.editorPending ? (
        <span className="text-attn-press text-meta mt-1 block">{MASTER_DATA_PENDING_NOTE}</span>
      ) : null}
    </>
  );
}

export function MasterDataBoard({
  counts,
  from,
  isManager,
}: {
  counts: MasterDataCounts;
  /** This page's own pathname — threaded to each destination's back chip. */
  from: string;
  /** procurement_manager / super_admin — money-set rows render for them only. */
  isManager: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {MASTER_DATA_GROUPS.map((group) => {
        const entries = visibleMasterDataEntries(group, isManager);
        if (entries.length === 0) return null;
        return (
          <section key={group.key}>
            <h2 className={SECTION_HEADING}>{group.label}</h2>
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => {
                const count = counts[entry.countKey];
                return (
                  <li key={entry.key} data-testid={`master-data-${entry.key}`}>
                    {entry.href === null ? (
                      <div className={CARD}>
                        <EntryBody entry={entry} count={count} />
                      </div>
                    ) : (
                      <Link href={withBackFrom(entry.href, from)} className={`${CARD} block`}>
                        <EntryBody entry={entry} count={count} />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
