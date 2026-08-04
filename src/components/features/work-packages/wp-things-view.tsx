// Spec 363 U4 slice 2 — the `ของ` tab's one state-grouped list (D5).
//
// Server component: it renders already-grouped rows and owns no state. The
// grouping rules and their justification live in `@/lib/work-packages/things`.
//
// Spec 363 U4 merge — คำขอซื้อ / เบิกของ / ค่าใช้จ่ายหน้างาน are now DELETED, so
// this is the WP's only item surface. Everything those tabs carried per line had
// to arrive here first: the three per-issue affordances (ยืนยันรับแทน ·
// แก้รายการที่บันทึกผิด · คืนเข้าคลัง) plus the receipt state and issue cost from
// the เบิกของ list, and the request's own status — รออนุมัติ covers four PR
// statuses, and PurchaseRequestCard, which used to draw the distinction, went
// with the tab.
//
// No PR AMOUNT renders here: purchase-request money stays hidden from
// `site_admin` (the existing posture — PurchaseRequestCard showed none and
// /requests gates every money field on isBackOfficeRole). The issue's unit cost
// is a different figure, shown to whoever the เบิกของ tab showed it to and to
// nobody else — see `canAct`.

import Link from "next/link";
import { Package, ShoppingCart } from "lucide-react";

import { WpThingIssueActions } from "@/components/features/work-packages/wp-thing-issue-actions";
import { baht } from "@/lib/format";
import { PURCHASE_REQUEST_STATUS_LABEL } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";
import {
  showsIssueActions,
  type WpThingGroup,
  type WpThingGroupKey,
  type WpThingRow,
} from "@/lib/work-packages/things";

function rowTitle(row: WpThingRow): string {
  return row.kind === "request"
    ? row.itemDescription
    : row.baseItem + (row.specAttrs ? ` ${row.specAttrs}` : "");
}

// The number a row shows depends on WHICH group it is in: an issue appears in
// both อยู่ที่งานนี้ and คืนแล้ว when it is partly returned, and printing the
// issued qty in both makes both wrong in the one tab whose job is "how much is
// where". 5 issued / 3 returned = 2 here and 3 returned.
function rowQty(row: WpThingRow, group: WpThingGroupKey): string {
  if (row.kind === "request") return `${row.quantity} ${row.unit}`;
  const n = group === "returned" ? row.returnedQty : row.qty - row.returnedQty;
  return `${n} ${row.unit}`;
}

function Row({
  row,
  group,
  requestHref,
  canAct,
}: {
  row: WpThingRow;
  group: WpThingGroupKey;
  requestHref: (id: string) => string;
  canAct: boolean;
}) {
  const Icon = row.kind === "request" ? ShoppingCart : Package;
  const body = (
    <>
      <Icon aria-hidden className="text-ink-muted size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="text-ink text-body block font-medium">{rowTitle(row)}</span>
        {row.kind === "request" ? (
          <span className="text-ink-secondary text-meta block">
            {/* The GROUP cannot answer "where is my cement": รออนุมัติ covers
                requested / approved / purchased / on_route. The card that used to
                draw that distinction went with the คำขอซื้อ tab. */}
            {`#${row.prNumber} · `}
            {/* Its own element, not a bare text node beside the number: the
                status is the part a reader scans for, and a split text node is
                also unassertable without a loose regex. */}
            <span className="font-medium">{PURCHASE_REQUEST_STATUS_LABEL[row.status]}</span>
          </span>
        ) : null}
      </span>
      <span className="text-ink text-body shrink-0 font-semibold">{rowQty(row, group)}</span>
    </>
  );

  // A request row still has somewhere to go — its detail page carries the
  // priority, the ETA and the decision history this list deliberately does not.
  if (row.kind === "request") {
    return (
      <Link
        href={requestHref(row.id)}
        className="border-edge hover:bg-page focus-visible:ring-action flex min-h-11 w-full items-center gap-3 border-b px-1 py-2.5 text-left last:border-b-0 focus:outline-none focus-visible:ring-2"
      >
        {body}
      </Link>
    );
  }

  // The detail IS the เบิกของ tab's issued-line content, moved wholesale — so it
  // keeps that tab's gate wholesale too. That tab rendered only under
  // `!readOnly`, which means the read-only viewer never saw the issue's unit
  // cost or its receipt state either; showing them here would be a quiet
  // ADDITION for that role rather than the re-homing this unit is.
  //
  // `showsIssueActions` then decides WHICH of an issue's rendered rows carries
  // it: a partly-returned issue appears twice and both are readings of one
  // `stock_issues` record, so it must show up exactly once.
  const showsDetail = canAct && showsIssueActions(row, group);

  return (
    <div className="border-edge border-b px-1 py-2.5 last:border-b-0">
      <div className="flex min-h-11 w-full items-center gap-3">{body}</div>
      {showsDetail ? (
        <div className="mt-1.5 flex flex-col gap-2 pl-8">
          <span className="text-ink-secondary text-meta">
            ต้นทุน {baht(row.unitCost)} ฿/{row.unit}
            {row.receiverName ? (
              <>
                {" · "}
                <span className={row.receivedAt ? "text-action" : "text-ink-secondary"}>
                  {row.receivedAt ? "รับแล้ว" : "รอรับ"}
                </span>
                {` ${row.receiverName}`}
              </>
            ) : null}
          </span>
          <WpThingIssueActions issue={row} />
        </div>
      ) : null}
    </div>
  );
}

export function WpThingsView({
  groups,
  requestHref,
  canAct,
}: {
  groups: WpThingGroup[];
  requestHref: (id: string) => string;
  /**
   * Whether the viewer gets the issue-row DETAIL at all — the three write
   * controls plus the unit cost and receipt state that travel with them. Same
   * decision the เบิกของ tab made by existing only under `!readOnly`: plain
   * `procurement` reads this page, and its one write is the purchase request,
   * which the ต้องการของ sheet owns. The rows themselves always render — "where
   * is my stuff" is the read-only half of this tab.
   */
  canAct: boolean;
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
        // role + aria-label are EXPLICIT: <details> maps to role "group" only in
        // real browsers, so relying on the implicit mapping would have the tests
        // assert against a tree the runtime does not build.
        <details key={g.key} open={!g.collapsed} role="group" aria-label={g.label} className={CARD}>
          <summary className="focus-visible:ring-action flex min-h-11 cursor-pointer items-center gap-2 rounded focus:outline-none focus-visible:ring-2">
            <span className="text-ink text-body flex-1 font-semibold">{g.label}</span>
            {/* The count is what makes a COLLAPSED group still report its size —
                otherwise closing it hides the fact that anything is in there. */}
            <span className="text-ink-secondary bg-sunk rounded-control text-meta px-2 py-0.5 font-semibold">
              {g.rows.length}
            </span>
          </summary>
          <div className="mt-2 flex flex-col">
            {g.rows.map((row) => (
              <Row
                key={`${row.kind}-${row.id}`}
                row={row}
                group={g.key}
                requestHref={requestHref}
                canAct={canAct}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
