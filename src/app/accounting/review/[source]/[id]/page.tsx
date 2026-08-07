// Spec 345 U3 — the money-event review voucher: ONE event's entered data, its
// documents (signed URLs), its GL trail, its review state + flags, and the
// verify/flag actions. Uniform across all 15 sources; purchase requests also
// link to the richer spec-196 purchase voucher rather than duplicating it.

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { safeBackHref } from "@/lib/nav/back-href";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES, MONEY_REVIEW_ROLES } from "@/lib/auth/role-home";
import {
  MONEY_REVIEW_LABEL,
  REVIEW_CHAIN_DONE,
  REVIEW_NEXT_CTA,
  DOC_NOT_ACCOUNTING_DOC,
  DOC_ON_PURCHASE_ORDER,
  DOC_WAIVED_LABEL,
  DOC_WAIVER_NONE,
  DOC_WAIVER_REASON_LABEL,
  DOC_WAIVER_SECTION_HEADING,
  formatThaiDate,
} from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import {
  MONEY_SOURCE_TABLES,
  moneySourceLabel,
  reviewStatusLabel,
  flagTypeLabel,
  type MoneyFlagType,
  type MoneySourceTable,
} from "@/lib/accounting/review-queue-view";
import { loadReviewVoucher } from "@/lib/accounting/load-review-voucher";
import { ReviewVoucherActions } from "@/components/features/accounting/review-voucher-actions";
import { PurchaseDocWaiverPanel } from "@/components/features/accounting/purchase-doc-waiver-panel";
import {
  verifyMoneyEventAction,
  flagMoneyEventAction,
  resolveMoneyFlagAction,
  dismissMoneyFlagAction,
  waivePurchaseDocsAction,
  unwaivePurchaseDocsAction,
} from "./actions";

export const metadata = { title: "รายละเอียดเอกสารการเงิน" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface VoucherPageProps {
  params: Promise<{ source: string; id: string }>;
  // Spec 373 D6 — multi-parent: reached from /accounting/review AND the
  // /expenses finance scope (list rows + reimburse-queue rows).
  searchParams: Promise<{ from?: string }>;
}

export default async function ReviewVoucherPage({ params, searchParams }: VoucherPageProps) {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const { source, id } = await params;
  const { from } = await searchParams;
  if (!(MONEY_SOURCE_TABLES as readonly string[]).includes(source) || !UUID_RE.test(id)) {
    notFound();
  }
  const sourceTable = source as MoneySourceTable;

  const data = await loadReviewVoucher(sourceTable, id);
  if (!data) notFound();
  const { event, review, flags, docs, journal, waiver } = data;

  // Spec 373 §6 — the verify chain door target comes from the loader (same
  // authed client, same error-throw posture; keyed on the DB-normalized event
  // id, never the raw URL param — a case-variant param must not make a door
  // to itself).
  const nextHref = data.nextPendingId
    ? `/accounting/review/${sourceTable}/${data.nextPendingId}${from ? `?from=${encodeURIComponent(from)}` : ""}`
    : null;

  const status = review?.status ?? "pending";
  const openFlags = flags.filter((f) => f.status === "open");
  const suggestedFlags = flags.filter((f) => f.status === "suggested");
  const closedFlags = flags.filter((f) => f.status === "resolved" || f.status === "dismissed");

  return (
    <>
      <DetailHeader
        backHref={safeBackHref(from, "/accounting/review")}
        backLabel={MONEY_REVIEW_LABEL}
      >
        <h1 className="text-foreground text-lg font-semibold">
          {moneySourceLabel(event.sourceTable)}
        </h1>
        <p className="text-muted-foreground text-sm">
          {event.counterparty ?? "—"}
          {event.projectName ? ` · ${event.projectName}` : ""}
        </p>
      </DetailHeader>
      <PageShell className={PAGE_MAX_W}>
        <section className={CARD}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs">
                {event.eventDate ? formatThaiDate(event.eventDate) : "—"}
              </p>
              <p className="text-foreground text-xl font-semibold">{baht(event.amount)}</p>
            </div>
            <p className="text-muted-foreground text-sm">{reviewStatusLabel(status)}</p>
          </div>
          {review?.status === "verified" ? (
            <p className="text-muted-foreground mt-2 text-xs">
              ตรวจโดย {review.verifiedByName ?? "—"}
              {review.verifiedAt ? ` · ${formatThaiDate(review.verifiedAt)}` : ""}
              {review.note ? ` · ${review.note}` : ""}
            </p>
          ) : null}
        </section>

        <h2 className={SECTION_HEADING}>เอกสาร ({docs.length})</h2>
        {docs.length === 0 ? (
          <p className="text-muted-foreground mb-4 text-sm">
            {event.docsExpected === "expected"
              ? "ไม่มีเอกสารแนบ"
              : event.docsExpected === "no_path_yet"
                ? "ยังไม่มีช่องแนบเอกสารสำหรับรายการประเภทนี้"
                : "รายการประเภทนี้ไม่ต้องใช้เอกสาร (มัสเตอร์คือหลักฐาน)"}
          </p>
        ) : (
          <ul className="mb-4 flex flex-col gap-1">
            {docs.map((d) => (
              <li key={d.url}>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-action text-sm underline"
                >
                  {d.label}
                </a>
              </li>
            ))}
          </ul>
        )}
        {/* Spec 380 U6 — this list is every attachment on the PURCHASE REQUEST,
            while doc_count is now the ACCOUNTING-document test (§3): class-aware
            and including PO-level documents. The two can therefore disagree in
            both directions, and the queue chip is driven by the count. Say which
            is which here, or the voucher silently contradicts the chip that sent
            the accountant to it. */}
        {event.sourceTable === "purchase_requests" && docs.length > 0 && event.docCount === 0 ? (
          <p className="text-attn-ink bg-attn-soft mb-4 rounded-md px-3 py-2 text-sm">
            {DOC_NOT_ACCOUNTING_DOC}
          </p>
        ) : null}
        {event.sourceTable === "purchase_requests" && docs.length === 0 && event.docCount > 0 ? (
          <p className="text-muted-foreground mb-4 text-sm">{DOC_ON_PURCHASE_ORDER}</p>
        ) : null}
        {event.sourceTable === "purchase_requests" ? (
          <p className="mb-4 text-sm">
            <Link
              href={`/accounting/purchases/${event.sourceId}`}
              className="text-action underline"
            >
              ดูเอกสารการซื้อฉบับเต็ม
            </Link>
          </p>
        ) : null}

        <h2 className={SECTION_HEADING}>การลงบัญชี</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          {journal
            ? `ลงบัญชีแล้ว — JE #${journal.entryNo} (${formatThaiDate(journal.entryDate)})${
                journal.count > 1 ? ` · ล่าสุดจากทั้งหมด ${journal.count} รายการ` : ""
              }`
            : "ยังไม่มีรายการลงบัญชีสำหรับเหตุการณ์นี้"}
        </p>

        <h2 className={SECTION_HEADING}>การตรวจ</h2>
        {(MONEY_REVIEW_ROLES as readonly string[]).includes(ctx.role) ? (
          <ReviewVoucherActions
            source={event.sourceTable}
            sourceId={event.sourceId}
            reviewStatus={status}
            openFlags={openFlags}
            suggestedFlags={suggestedFlags}
            verify={verifyMoneyEventAction}
            flag={flagMoneyEventAction}
            resolve={resolveMoneyFlagAction}
            dismiss={dismissMoneyFlagAction}
          />
        ) : (
          // ACCOUNTING_ROLES may read the voucher; the write authority is the
          // deliberately-separate MONEY_REVIEW_ROLES (role-home) — if the sets
          // ever diverge, a read-only accountant sees the state, not dead buttons.
          <p className="text-muted-foreground text-sm">ดูอย่างเดียว — ไม่มีสิทธิ์ตรวจ/ติดธง</p>
        )}

        {/* Spec 380 U6 — the doc waiver (§2 decision ③, accounting-only), so it
            sits inside the SAME MONEY_REVIEW_ROLES gate as the actions above and
            only for purchase requests, the only source a waiver keys on. A
            read-only accountant still sees the recorded state via the section
            below rather than a control that would refuse them. */}
        {event.sourceTable === "purchase_requests" ? (
          <>
            <h2 className={`${SECTION_HEADING} mt-6`}>{DOC_WAIVER_SECTION_HEADING}</h2>
            {(MONEY_REVIEW_ROLES as readonly string[]).includes(ctx.role) ? (
              <PurchaseDocWaiverPanel
                purchaseRequestId={event.sourceId}
                waiver={waiver}
                waive={waivePurchaseDocsAction}
                unwaive={unwaivePurchaseDocsAction}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                {waiver
                  ? `${DOC_WAIVED_LABEL} — ${DOC_WAIVER_REASON_LABEL[waiver.reason]}`
                  : DOC_WAIVER_NONE}
              </p>
            )}
          </>
        ) : null}

        {/* Spec 373 §6 — the chain door: after deciding, walk straight to the
            oldest remaining pending voucher of this source; the ?from= referrer
            rides along so the whole chain returns to one origin. */}
        <p className="mt-4">
          {nextHref ? (
            <Link href={nextHref} className="text-action text-sm font-medium underline">
              {REVIEW_NEXT_CTA} →
            </Link>
          ) : (
            <span className="text-muted-foreground text-sm">{REVIEW_CHAIN_DONE}</span>
          )}
        </p>

        {closedFlags.length > 0 ? (
          <>
            <h2 className={`${SECTION_HEADING} mt-6`}>ประวัติธง</h2>
            <ul className="flex flex-col gap-1">
              {closedFlags.map((f) => (
                <li key={f.id} className="text-muted-foreground text-sm">
                  {flagTypeLabel(f.flagType as MoneyFlagType)} — {f.resolution ?? "—"} (
                  {f.status === "resolved" ? "แก้ไขแล้ว" : "ปัดตก"}
                  {f.resolvedAt ? ` · ${formatThaiDate(f.resolvedAt)}` : ""})
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </PageShell>
      <BottomTabBar role={ctx.role} />
    </>
  );
}
