// Spec 363 U4 slice 2 — the `ของ` tab's one state-grouped list (D5).
//
// Server component: it renders already-grouped rows and owns no state. The
// grouping rules and their justification live in `@/lib/work-packages/things`.
//
// ⚠️ ADDITIVE. This does NOT delete คำขอซื้อ / เบิกของ / ค่าใช้จ่ายหน้างาน. Those
// tabs still carry three per-issue affordances — ยืนยันรับแทน, แก้รายการที่บันทึกผิด
// and คืนเข้าคลัง — and a tab may not be deleted before its affordances have a
// new home. The merge PR moves them into the row detail; until then this list is
// read-only and every row points at where its action already lives.
//
// No money renders here: PR amounts stay hidden from `site_admin` (the existing
// posture — PurchaseRequestCard shows none and /requests gates every money field
// on isBackOfficeRole).

import Link from "next/link";
import { Package, ShoppingCart } from "lucide-react";

import { CARD } from "@/lib/ui/classes";
import type { WpThingGroup, WpThingRow } from "@/lib/work-packages/things";

function rowTitle(row: WpThingRow): string {
  return row.kind === "request"
    ? row.itemDescription
    : row.baseItem + (row.specAttrs ? ` ${row.specAttrs}` : "");
}

function rowQty(row: WpThingRow): string {
  return row.kind === "request" ? `${row.quantity} ${row.unit}` : `${row.qty} ${row.unit}`;
}

function Row({ row, requestHref }: { row: WpThingRow; requestHref: (id: string) => string }) {
  const Icon = row.kind === "request" ? ShoppingCart : Package;
  const body = (
    <>
      <Icon aria-hidden className="text-ink-muted size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="text-ink text-body block font-medium">{rowTitle(row)}</span>
        {row.kind === "request" ? (
          <span className="text-ink-secondary text-meta block">#{row.prNumber}</span>
        ) : null}
      </span>
      <span className="text-ink text-body shrink-0 font-semibold">{rowQty(row)}</span>
    </>
  );

  // A request row still has somewhere to go (its detail page); an issue row's
  // actions live in the เบิกของ tab until the merge PR relocates them, so it
  // stays inert rather than pretending to be a link.
  return row.kind === "request" ? (
    <Link
      href={requestHref(row.id)}
      className="border-edge hover:bg-page focus-visible:ring-action flex min-h-11 w-full items-center gap-3 border-b px-1 py-2.5 text-left last:border-b-0 focus:outline-none focus-visible:ring-2"
    >
      {body}
    </Link>
  ) : (
    <div className="border-edge flex min-h-11 w-full items-center gap-3 border-b px-1 py-2.5 last:border-b-0">
      {body}
    </div>
  );
}

export function WpThingsView({
  groups,
  requestHref,
}: {
  groups: WpThingGroup[];
  requestHref: (id: string) => string;
}) {
  const present = groups.filter((g) => g.rows.length > 0);

  if (present.length === 0) {
    return (
      <div className={CARD}>
        <p className="text-ink-secondary text-body">ยังไม่มีของสำหรับงานนี้</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {present.map((g) => (
        <details key={g.key} open={!g.collapsed} className={CARD}>
          <summary className="flex cursor-pointer items-center gap-2">
            <h3 className="text-ink text-body flex-1 font-semibold">{g.label}</h3>
            {/* The count is what makes a COLLAPSED group still report its size —
                otherwise closing it hides the fact that anything is in there. */}
            <span className="text-ink-secondary bg-sunk rounded-control text-meta px-2 py-0.5 font-semibold">
              {g.rows.length}
            </span>
          </summary>
          <div className="mt-2 flex flex-col">
            {g.rows.map((row) => (
              <Row key={`${row.kind}-${row.id}`} row={row} requestHref={requestHref} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
