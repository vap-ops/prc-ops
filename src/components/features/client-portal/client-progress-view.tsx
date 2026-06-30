// Spec 233 / ADR 0067 U4 — the read-only client progress surface. Renders the
// four entitled surfaces (project summary · WP status · approved photos ·
// completed report PDFs) for the one live project. NO money, NO notes, NO edit
// affordances — a logout is the only control. A Server Component (no 'use
// client'): every value is already loaded server-side by loadClientView.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { EmptyNotice } from "@/components/features/common/notices";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { WORK_PACKAGE_STATUS_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import type { ClientView } from "@/lib/client-portal/load-client-view";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-ink-secondary text-sm">{label}</dt>
      <dd className="text-ink min-w-0 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

export function ClientProgressView({ view }: { view: ClientView }) {
  const { project, workPackages, photos, reports } = view;
  const hasSummary = project.siteAddress || project.startDate || project.plannedCompletion;

  return (
    <PageShell>
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <div className="min-w-0">
            <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
            <h1 className="text-title text-ink truncate font-bold tracking-tight">
              {project.name}
            </h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {hasSummary ? (
          <dl className={`${CARD} mb-6`}>
            {project.siteAddress ? (
              <SummaryRow label="สถานที่" value={project.siteAddress} />
            ) : null}
            {project.startDate ? (
              <SummaryRow label="เริ่มโครงการ" value={formatThaiDate(project.startDate)} />
            ) : null}
            {project.plannedCompletion ? (
              <SummaryRow label="กำหนดเสร็จ" value={formatThaiDate(project.plannedCompletion)} />
            ) : null}
          </dl>
        ) : null}

        <h2 className={SECTION_HEADING}>ความคืบหน้างาน</h2>
        {workPackages.length > 0 ? (
          <ul className={`${CARD} divide-edge mb-6 flex flex-col divide-y`}>
            {workPackages.map((wp) => (
              <li key={wp.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink min-w-0 truncate text-sm">
                  <span className="text-ink-muted font-mono">{wp.code}</span> {wp.name}
                </span>
                <span className="text-ink-secondary shrink-0 text-xs">
                  {WORK_PACKAGE_STATUS_LABEL[wp.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mb-6">
            <EmptyNotice>ยังไม่มีรายการงาน</EmptyNotice>
          </div>
        )}

        <h2 className={SECTION_HEADING}>รูปความคืบหน้า</h2>
        {photos.length > 0 ? (
          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((p) => (
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
          <div className="mb-6">
            <EmptyNotice>ยังไม่มีรูปที่อนุมัติ</EmptyNotice>
          </div>
        )}

        <h2 className={SECTION_HEADING}>รายงานความคืบหน้า</h2>
        {reports.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {reports.map((r) => (
              <li key={r.id}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${CARD} flex items-center justify-between gap-3`}
                >
                  <span className="text-ink text-sm">รายงาน {formatThaiDate(r.createdAt)}</span>
                  <span className="text-action text-xs font-medium">เปิด</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNotice>ยังไม่มีรายงาน</EmptyNotice>
        )}
      </section>
    </PageShell>
  );
}
