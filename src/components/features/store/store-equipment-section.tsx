"use client";

// Spec 368 U1 + U4 — เครื่องมือและอุปกรณ์ on the project store page.
//
// U1 put the DURABLE tools beside the stock list; U4 (operator-locked
// 2026-07-28) splits them into the two states the custodian actually manages:
// ยืมไปที่งาน (open usage-log obligations — WP chip, aging clock, who has it,
// oldest first) over อยู่ในคลัง (category groups, bulk ×qty). คืน happens HERE
// because the tool physically lands at the store — via the SHARED return sheet
// (via="store"), the same component the WP ของ tab uses, so the two doors
// cannot drift. ยืม is deliberately NOT here: borrowing is item-first at the WP
// (363 D6/U7) or scan-first (spec 370); the scan, not a browse list, is the
// door (§5).
//
// "Out" derives from OPEN LOGS the server computed with the check_out
// anti-join — never from equipment_items.status, which movements clobber
// (368 §6.1). Renders NOTHING when the whole set is empty (U1's rule).

import { useState } from "react";
import Link from "next/link";
import { CARD } from "@/lib/ui/classes";
import { workPackageHref } from "@/lib/nav/project-paths";
import { EQUIPMENT_CONDITION_LABEL, EQUIPMENT_STATUS_LABEL } from "@/lib/i18n/labels";
import {
  EquipmentReturnSheet,
  agingLabel,
  type ReturnableLoan,
} from "@/components/features/equipment/return-sheet";
import type { StoreOutRow, StoreSplitItem } from "@/lib/equipment/store-split";
import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

export function StoreEquipmentSection({
  out,
  inStore,
  counts,
  canReturn,
  revalidate,
  projectId,
}: {
  out: readonly StoreOutRow[];
  inStore: readonly StoreSplitItem[];
  counts: { inStore: number; out: number };
  canReturn: boolean;
  revalidate: string;
  // A string, NOT an href-builder function: a function prop cannot cross the
  // Server→Client boundary (caught live by the SSR probe — jsdom tests render
  // client-side and never see the RSC serialization error).
  projectId: string;
}) {
  const [returnLoan, setReturnLoan] = useState<ReturnableLoan | null>(null);

  if (out.length === 0 && inStore.length === 0) return null;

  // Grouped by category, matching the วัสดุ list's `label (n)` section idiom
  // (spec 362) so the two halves of the store read as one screen.
  const byCategory = new Map<string, StoreSplitItem[]>();
  for (const it of inStore) {
    const bucket = byCategory.get(it.categoryName);
    if (bucket) bucket.push(it);
    else byCategory.set(it.categoryName, [it]);
  }
  const groups = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], "th"));

  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-ink text-sm font-semibold">เครื่องมือและอุปกรณ์</p>
        <p className="text-ink-secondary text-meta">
          {counts.inStore} ในคลัง · {counts.out} ยืมออก
        </p>
      </div>
      {canReturn ? (
        // Spec 370 U4 — the scan door (D1: scan is the primary way in/out).
        // Same audience as คืน; the deep link itself works from anywhere.
        <Link
          href={`/equipment/scan?from=${encodeURIComponent(`/projects/${projectId}/store`)}`}
          className="border-edge-strong rounded-control text-ink mt-2 flex min-h-11 items-center justify-center border text-sm font-medium"
        >
          สแกนยืม/คืนอุปกรณ์
        </Link>
      ) : null}
      <p className="text-ink-secondary mt-1 text-xs">
        อุปกรณ์ที่บันทึกว่าอยู่ที่โครงการนี้ — แยกจากวัสดุในคลัง ย้ายอุปกรณ์ได้ที่หน้าอุปกรณ์
      </p>

      {out.length > 0 ? (
        <div className="mt-3">
          <p className="text-attn text-meta font-medium">ยืมไปที่งาน ({out.length})</p>
          <ul className="mt-1 flex flex-col">
            {out.map((r) => (
              <li
                key={r.logId}
                className="border-edge flex min-h-11 items-center gap-3 border-b py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-ink text-sm">{r.itemName}</p>
                  <p className="text-ink-secondary text-meta">
                    <Link
                      href={workPackageHref(projectId, r.wpId)}
                      className="text-action underline-offset-2"
                    >
                      {r.wpCode} {r.wpName}
                    </Link>
                    {" · "}
                    {agingLabel(r.days)} · {r.holderName}
                  </p>
                </div>
                {canReturn ? (
                  <button
                    type="button"
                    onClick={() =>
                      setReturnLoan({
                        logId: r.logId,
                        itemName: r.itemName,
                        holderName: r.holderName,
                        days: r.days,
                      })
                    }
                    className="border-edge-strong rounded-control text-ink min-h-11 border px-3 text-sm"
                  >
                    คืน
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {groups.map(([category, rows]) => (
        <div key={category} className="mt-3">
          <p className="text-ink-secondary text-meta font-medium">
            {category} ({rows.length})
          </p>
          <ul className="mt-1 flex flex-col">
            {rows
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, "th"))
              .map((it) => (
                <li
                  key={it.id}
                  className="border-edge flex items-center gap-3 border-b py-2 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-ink text-sm">{it.name}</p>
                    <p className="text-ink-secondary text-meta">
                      {EQUIPMENT_STATUS_LABEL[it.status as Enums["equipment_status"]]}
                      {it.condition
                        ? ` · ${EQUIPMENT_CONDITION_LABEL[it.condition as Enums["equipment_condition"]]}`
                        : ""}
                      {it.assetTag ? ` · ${it.assetTag}` : ""}
                    </p>
                  </div>
                  {it.tracking === "bulk" && it.quantity !== null ? (
                    <span className="border-edge bg-sunk rounded-control text-ink-secondary text-meta border px-2 py-0.5">
                      ×{it.quantity}
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ))}

      <EquipmentReturnSheet
        loan={returnLoan}
        via="store"
        revalidate={revalidate}
        onClose={() => setReturnLoan(null)}
      />
    </div>
  );
}
