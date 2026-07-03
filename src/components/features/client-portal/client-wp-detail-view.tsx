// Client WP-detail drill (extends spec 233/234 U4) — the read-only single-WP
// surface: description, planned dates, status, and the WP's own approved
// photos. NO money, NO notes, NO edit affordances. A Server Component (no
// 'use client'): every value is already loaded server-side by
// loadClientWpDetail.

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { EmptyNotice } from "@/components/features/common/notices";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import {
  WORK_PACKAGE_STATUS_LABEL,
  WORK_PACKAGE_PRIORITY_LABEL,
  WORK_CATEGORY_UNSET_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import type { ClientWpDetailView as ClientWpDetailViewModel } from "@/lib/client-portal/load-client-wp-detail";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-ink-secondary text-sm">{label}</dt>
      <dd className="text-ink min-w-0 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

export function ClientWpDetailView({
  detail,
  backHref,
}: {
  detail: ClientWpDetailViewModel;
  backHref: string;
}) {
  return (
    <PageShell>
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={backHref}
              aria-label="ย้อนกลับ"
              className="text-ink-secondary hover:text-ink shrink-0 text-xl leading-none"
            >
              ←
            </Link>
            <div className="min-w-0">
              <p className="text-meta text-ink-secondary font-mono">{detail.code}</p>
              <h1 className="text-title text-ink truncate font-bold tracking-tight">
                {detail.name}
              </h1>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <dl className={`${CARD} mb-6`}>
          <SummaryRow label="สถานะ" value={WORK_PACKAGE_STATUS_LABEL[detail.status]} />
          {detail.priority !== undefined ? (
            <>
              <SummaryRow
                label="หมวดงาน"
                value={detail.categoryName ?? WORK_CATEGORY_UNSET_LABEL}
              />
              <SummaryRow label="ความสำคัญ" value={WORK_PACKAGE_PRIORITY_LABEL[detail.priority]} />
            </>
          ) : null}
          {detail.description ? <SummaryRow label="รายละเอียด" value={detail.description} /> : null}
          {detail.plannedStart ? (
            <SummaryRow label="เริ่มงาน" value={formatThaiDate(detail.plannedStart)} />
          ) : null}
          {detail.plannedEnd ? (
            <SummaryRow label="กำหนดเสร็จ" value={formatThaiDate(detail.plannedEnd)} />
          ) : null}
        </dl>

        <h2 className={SECTION_HEADING}>รูปความคืบหน้า</h2>
        {detail.photos.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {detail.photos.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-card border-edge block overflow-hidden border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </a>
            ))}
          </div>
        ) : (
          <EmptyNotice>ยังไม่มีรูปที่อนุมัติ</EmptyNotice>
        )}
      </section>
    </PageShell>
  );
}
