// Spec 196 Tier 3 (U6) — purchase voucher. One PR with its source documents
// (invoice / delivery / payment proof) AND the GL entry it posted — the auditor's
// document → ledger tie. Gated to ACCOUNTING_ROLES; reads via admin behind the
// gate. Quote/price evidence is omitted (procurement-only, the spec-196 decision).

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import { deriveVatBreakdown } from "@/lib/purchasing/vat";
import { formatPoNumber } from "@/lib/purchasing/format-id";
import { withBackFrom } from "@/lib/nav/back-href";
import { loadPurchaseVoucher } from "@/lib/accounting/load-voucher";
import { purchaseStatusLabel, attachmentPurposeLabel } from "@/lib/accounting/purchases-view";

export const metadata = { title: "ใบสำคัญจัดซื้อ" };

interface VoucherPageProps {
  params: Promise<{ id: string }>;
}

export default async function VoucherPage({ params }: VoucherPageProps) {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const { id } = await params;
  const admin = createAdminClient();
  const { header, attachments, glLines } = await loadPurchaseVoucher(admin, id);
  if (!header) notFound();

  const vat = deriveVatBreakdown(header.gross, header.vatRate);

  // Spec 211 U9b: the PO row links into the PO detail (accounting may now open it,
  // PO_DETAIL_VIEW_ROLES); ?from returns its back chip to this voucher. Other rows
  // are plain text (the optional 3rd tuple element is the link href).
  type MetaRow = [string, string, string?];
  const META: MetaRow[] = [
    ["โครงการ", header.projectLabel],
    ...(header.wpLabel ? ([["งานย่อย", header.wpLabel]] as MetaRow[]) : []),
    ["สถานะ", purchaseStatusLabel(header.status)],
    ...(header.poNumber !== null
      ? ([
          [
            "ใบสั่งซื้อ",
            formatPoNumber(header.poNumber),
            header.poId
              ? withBackFrom(`/requests/orders/${header.poId}`, `/accounting/purchases/${id}`)
              : undefined,
          ],
        ] as MetaRow[])
      : []),
    ...(header.purchasedAt
      ? ([["วันที่จัดซื้อ", formatThaiDate(header.purchasedAt)]] as MetaRow[])
      : []),
    ...(header.requesterName ? ([["ผู้ขอซื้อ", header.requesterName]] as MetaRow[]) : []),
    ...(header.approverName ? ([["ผู้อนุมัติ", header.approverName]] as MetaRow[]) : []),
  ];

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting/purchases" backLabel="การจัดซื้อ">
        <h1 className="text-title text-ink font-bold tracking-tight">ใบสำคัญจัดซื้อ</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {/* Header: supplier + amount breakdown. */}
        <div className={`${CARD} mb-6`}>
          <p className="text-ink text-base font-bold">{header.supplierLabel}</p>
          <dl className="divide-edge mt-3 flex flex-col divide-y">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink-secondary text-sm">มูลค่าก่อนภาษี</dt>
              <dd className="text-ink text-sm font-medium tabular-nums">{baht(vat.net)}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink-secondary text-sm">
                ภาษีมูลค่าเพิ่ม{header.vatRate > 0 ? ` (${header.vatRate}%)` : ""}
              </dt>
              <dd className="text-ink text-sm font-medium tabular-nums">{baht(vat.vat)}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink text-sm font-semibold">รวมทั้งสิ้น</dt>
              <dd className="text-ink text-base font-bold tabular-nums">{baht(vat.gross)}</dd>
            </div>
          </dl>
        </div>

        {/* Document facts. */}
        <div className={`${CARD} mb-6`}>
          <dl className="divide-edge flex flex-col divide-y">
            {META.map(([k, v, href]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-secondary shrink-0 text-sm">{k}</dt>
                <dd className="text-ink min-w-0 truncate text-right text-sm font-medium">
                  {href ? (
                    <Link
                      href={href}
                      className="text-action underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                    >
                      {v}
                    </Link>
                  ) : (
                    v
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Source documents — invoice / delivery proof / payment proof. */}
        <h2 className={SECTION_HEADING}>เอกสารประกอบ</h2>
        {attachments.length === 0 ? (
          <EmptyNotice>ไม่มีเอกสารแนบ</EmptyNotice>
        ) : (
          <ul className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {attachments.map((a) => (
              <li key={a.id} className={`${CARD} flex flex-col gap-2`}>
                <span className="text-ink-secondary text-xs font-medium">
                  {attachmentPurposeLabel(a.purpose)}
                </span>
                {a.href ? (
                  a.kind === "image" ? (
                    <a href={a.href} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.href}
                        alt={attachmentPurposeLabel(a.purpose)}
                        className="border-edge h-28 w-full rounded-md border object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      href={a.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-action text-sm underline"
                    >
                      เปิดลิงก์
                    </a>
                  )
                ) : (
                  <span className="text-ink-muted text-xs">เปิดไม่ได้</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* The GL entry this purchase posted — the document → ledger tie. */}
        <h2 className={SECTION_HEADING}>การลงบัญชี</h2>
        {glLines.length === 0 ? (
          <EmptyNotice>ยังไม่ลงบัญชี</EmptyNotice>
        ) : (
          <div className={CARD}>
            <div className="border-edge mb-2 flex items-center justify-between gap-3 border-b pb-2">
              <p className="text-ink-secondary text-xs">บัญชี</p>
              <p className="text-ink-secondary shrink-0 text-xs">เดบิต / เครดิต</p>
            </div>
            <ul className="divide-edge flex flex-col divide-y">
              {glLines.map((l, i) => (
                <li
                  key={`${l.accountCode}-${i}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-medium">{l.accountName}</p>
                    <p className="text-ink-muted text-xs">{l.accountCode}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-ink text-sm font-medium tabular-nums">
                      {l.debit > 0 ? baht(l.debit) : "—"}
                    </p>
                    <p className="text-ink-secondary text-xs tabular-nums">
                      {l.credit > 0 ? baht(l.credit) : "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </PageShell>
  );
}
