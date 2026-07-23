// Spec 345 U3 — the money-event review voucher: ONE event's entered data, its
// documents (signed URLs), its GL trail, its review state + flags, and the
// verify/flag actions. Uniform across all 15 sources; purchase requests also
// link to the richer spec-196 purchase voucher rather than duplicating it.

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { MONEY_REVIEW_LABEL, formatThaiDate } from "@/lib/i18n/labels";
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
import {
  verifyMoneyEventAction,
  flagMoneyEventAction,
  resolveMoneyFlagAction,
  dismissMoneyFlagAction,
} from "./actions";

export const metadata = { title: MONEY_REVIEW_LABEL };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface VoucherPageProps {
  params: Promise<{ source: string; id: string }>;
}

export default async function ReviewVoucherPage({ params }: VoucherPageProps) {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const { source, id } = await params;
  if (!(MONEY_SOURCE_TABLES as readonly string[]).includes(source) || !UUID_RE.test(id)) {
    notFound();
  }
  const sourceTable = source as MoneySourceTable;

  const data = await loadReviewVoucher(sourceTable, id);
  if (!data) notFound();
  const { event, review, flags, docs, journal } = data;

  const status = review?.status ?? "pending";
  const openFlags = flags.filter((f) => f.status === "open");
  const suggestedFlags = flags.filter((f) => f.status === "suggested");
  const closedFlags = flags.filter((f) => f.status === "resolved" || f.status === "dismissed");

  return (
    <>
      <DetailHeader backHref="/accounting/review" backLabel={MONEY_REVIEW_LABEL}>
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
            ? `ลงบัญชีแล้ว — JE #${journal.entryNo} (${formatThaiDate(journal.entryDate)})`
            : "ยังไม่มีรายการลงบัญชีสำหรับเหตุการณ์นี้"}
        </p>

        <h2 className={SECTION_HEADING}>การตรวจ</h2>
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
