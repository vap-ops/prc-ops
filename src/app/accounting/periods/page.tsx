// Spec 196 Tier 4 — month-end close. The accounting role opens a period, walks it
// open → closing → closed, and (super_admin only) reopens or locks it. A closed
// period rejects new GL postings (resolve_posting_period → P0002), so this is the
// control that freezes a month's books. Gated to ACCOUNTING_ROLES; periods read
// via admin behind the gate, transitions run through the definer RPCs (actions).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { formatThaiDate } from "@/lib/i18n/labels";
import {
  SECTION_HEADING,
  CARD,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
} from "@/lib/ui/classes";
import {
  PERIOD_STATUSES,
  canTransitionPeriod,
  firstOfMonth,
  type PeriodStatus,
} from "@/lib/accounting/period";
import { loadPeriods } from "@/lib/accounting/load-periods";
import { openPeriodAction, setPeriodStatusAction } from "./actions";

export const metadata = { title: "ปิดงวดบัญชี" };

const STATUS_LABEL: Record<string, string> = {
  open: "เปิดอยู่",
  closing: "กำลังปิด",
  closed: "ปิดแล้ว",
  locked: "ล็อก (ยื่นภาษีแล้ว)",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-done-soft text-done-strong",
  closing: "bg-attn-soft text-attn-ink",
  closed: "bg-sunk text-ink-secondary",
  locked: "bg-sunk text-ink-muted",
};

// Per-transition label + confirm copy, keyed `${from}->${to}`.
const TRANSITION: Record<string, { label: string; confirm: string; primary?: boolean }> = {
  "open->closing": {
    label: "เริ่มปิดงวด",
    confirm: "เริ่มกระบวนการปิดงวดนี้? (ยังลงรายการได้จนกว่าจะปิด)",
  },
  "closing->closed": {
    label: "ยืนยันปิดงวด",
    confirm: "ปิดงวดนี้? จะลงรายการใหม่ในงวดนี้ไม่ได้ — มีเพียงผู้ดูแลระบบที่เปิดใหม่ได้",
    primary: true,
  },
  "closing->open": {
    label: "ยกเลิกการปิด",
    confirm: "กลับไปสถานะเปิด?",
  },
  "closed->open": {
    label: "เปิดงวดใหม่",
    confirm: "เปิดงวดที่ปิดแล้วอีกครั้ง?",
  },
  "closed->locked": {
    label: "ล็อกถาวร",
    confirm: "ล็อกงวดนี้ถาวร? (ยื่นภาษีแล้ว — ปลดล็อกไม่ได้)",
  },
};

export default async function PeriodsPage() {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const isSuper = ctx.role === "super_admin";

  const admin = createAdminClient();
  const supabase = await createClient();
  const [periods, recon] = await Promise.all([
    loadPeriods(admin),
    supabase.rpc("gl_reconciliation"),
  ]);

  // Posting backlog: unposted money events. Closing a month with a backlog would
  // strand those postings — surface it as the pre-close guard.
  const backlog = (recon.data ?? []).find((c) => c.check_name === "posting_backlog");
  const backlogCount = backlog ? Number(backlog.drift) : 0;

  const thisMonth = firstOfMonth(bangkokTodayIso());
  const hasThisMonth = periods.some((p) => p.month === thisMonth);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">ปิดงวดบัญชี</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {backlogCount > 0 ? (
          <div className="rounded-control border-attn bg-attn-soft text-attn-ink mb-6 border-l-4 px-4 py-3 text-sm">
            มีรายการรอลงบัญชี {backlogCount} รายการ — ควรลงให้ครบก่อนปิดงวด
          </div>
        ) : null}

        {!hasThisMonth ? (
          <div className={`${CARD} mb-6 flex items-center justify-between gap-3`}>
            <div className="min-w-0">
              <p className="text-ink text-sm font-medium">{formatThaiDate(thisMonth)}</p>
              <p className="text-ink-muted text-xs">ยังไม่เปิดงวดเดือนนี้</p>
            </div>
            <ConfirmActionButton
              idleLabel="เปิดงวดเดือนนี้"
              pendingLabel="กำลังเปิด…"
              confirmMessage={`เปิดงวดบัญชีเดือน ${formatThaiDate(thisMonth)}?`}
              confirmLabel="เปิดงวด"
              buttonClassName={BUTTON_SECONDARY_COMPACT}
              action={openPeriodAction.bind(null, thisMonth)}
            />
          </div>
        ) : null}

        <h2 className={SECTION_HEADING}>งวดบัญชี</h2>
        {periods.length === 0 ? (
          <EmptyNotice>ยังไม่มีงวดบัญชี</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {periods.map((p) => {
              const targets = (PERIOD_STATUSES as readonly PeriodStatus[]).filter((t) =>
                canTransitionPeriod(p.status, t, isSuper),
              );
              return (
                <li key={p.month} className={CARD}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink text-sm font-semibold">{formatThaiDate(p.month)}</p>
                      {p.closedAt ? (
                        <p className="text-ink-muted text-xs">
                          ปิดเมื่อ {formatThaiDate(p.closedAt)}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[p.status] ?? "bg-sunk text-ink-secondary"}`}
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  {targets.length > 0 ? (
                    <div className="border-edge mt-3 flex flex-wrap gap-2 border-t pt-3">
                      {targets.map((t) => {
                        const meta = TRANSITION[`${p.status}->${t}`];
                        if (!meta) return null;
                        return (
                          <ConfirmActionButton
                            key={t}
                            idleLabel={meta.label}
                            pendingLabel="กำลังทำรายการ…"
                            confirmMessage={meta.confirm}
                            confirmLabel={meta.label}
                            buttonClassName={
                              meta.primary ? BUTTON_PRIMARY_COMPACT : BUTTON_SECONDARY_COMPACT
                            }
                            action={setPeriodStatusAction.bind(null, p.month, t)}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
