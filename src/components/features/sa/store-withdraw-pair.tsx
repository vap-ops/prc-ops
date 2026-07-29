// Spec 375 U3 — the `เบิกจากคลังหน้างาน` custody pair.
//
// Operator, 2026-07-29: "why not have เบิกวัสดุ next to เบิกอุปกรณ์?" The site
// admin has custody of BOTH materials and equipment, and both are withdrawals
// from the same physical store (SA-custody + store-first doctrine) — so they
// belong under one heading, in one container, as one category. Before this they
// were unrelated: a generic คลัง tile in the tools grid, and (since spec 370 U4)
// a lone equipment hero elsewhere on the page.
//
// Live grounding: over 7 days a site_admin generated 4 route events on
// `/equipment*` against 21 on the project store, and `equipment_usage_logs` is
// still 0 rows across 64 items. The equipment half is the one with no traffic;
// pairing it with the door she already uses is what teaches it.
//
// ⚠️ ONE materials door. This REPLACES the คลัง tile in SaTools — rendering both
// would be the duplicate-door defect that retired the ทีมงาน tile (spec 313 U3).
// `คลัง` survives as the DESTINATION noun in the hub row and bottom tab; these
// two are the ACTIONS.
//
// ⓘ No counts, deliberately narrowing spec §2.4. A CORRECT open-loan count needs
// the supersede ANTI-JOIN (open candidates minus rows pointed at by another row's
// `superseded_by`, ADR 0009) — two row-reads plus in-memory filtering, which is
// exactly the read spec 370 refused to put on the app's heaviest page. The naive
// `superseded_by is null` form is the documented WRONG read and would resurrect
// closed loans as open. A wrong number on the SA's home is worse than none; the
// store page already does the anti-join and shows the real figures.
//
// Server-component safe: two pure Links, no client state.

import Link from "next/link";
import { ChevronRight, Package, QrCode } from "lucide-react";

import { storeHref } from "@/lib/nav/project-paths";
import {
  STORE_WITHDRAW_HEADING,
  WITHDRAW_MATERIALS_LABEL,
  WITHDRAW_MATERIALS_HINT,
  WITHDRAW_EQUIPMENT_LABEL,
  WITHDRAW_EQUIPMENT_HINT,
} from "@/lib/i18n/labels";

const HALF =
  "rounded-control focus-visible:ring-action hover:bg-sunk flex min-h-16 flex-1 items-center gap-2.5 px-3 py-3 transition-colors focus:outline-none focus-visible:ring-2";

export function StoreWithdrawPair({
  /** The SA's resolved current project; null → the picker, mirroring SaTools. */
  projectId,
  /** Where the scan door sends her back to. */
  from,
}: {
  projectId: string | null;
  from: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-meta text-ink-secondary font-semibold">{STORE_WITHDRAW_HEADING}</h2>
      {/* One bordered container, split down the middle — the container is what
          makes the two read as a pair rather than as two adjacent tiles. */}
      <div className="rounded-card border-edge bg-card shadow-card flex items-stretch border p-1">
        <Link href={projectId ? storeHref(projectId) : "/projects"} className={HALF}>
          <Package aria-hidden className="text-cat-w05 size-6 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body text-ink font-semibold">{WITHDRAW_MATERIALS_LABEL}</span>
            <span className="text-meta text-ink-muted">{WITHDRAW_MATERIALS_HINT}</span>
          </span>
          <ChevronRight aria-hidden className="text-ink-muted size-4 shrink-0" />
        </Link>
        <span aria-hidden className="bg-edge my-2 w-px shrink-0" />
        <Link href={`/equipment/scan?from=${encodeURIComponent(from)}`} className={HALF}>
          {/* The scan glyph in neutral ink: it must read as "this opens a
              scanner" without competing with the amber capture FAB. */}
          <QrCode aria-hidden className="text-ink size-6 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body text-ink font-semibold">{WITHDRAW_EQUIPMENT_LABEL}</span>
            <span className="text-meta text-ink-muted">{WITHDRAW_EQUIPMENT_HINT}</span>
          </span>
          <ChevronRight aria-hidden className="text-ink-muted size-4 shrink-0" />
        </Link>
      </div>
    </section>
  );
}
