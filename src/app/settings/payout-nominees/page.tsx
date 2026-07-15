// Spec 320 U2 — the PM soft-worklist for temporary payout nominees. Lists every
// worker on a nominee with a days-on-nominee age chip (the reclaim pressure) and
// a per-row clear. procurement_manager-gated (the RPCs re-gate). worker_payout_
// nominee is zero-grant bank PII, read via the DEFINER list RPC; worker name +
// PRC code are resolved through the admin seam (fetchNomineeWorkerRefs).

import Link from "next/link";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { ClearNomineeButton } from "@/components/features/payroll/clear-nominee-button";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAYOUT_NOMINEE_ADD, PAYOUT_NOMINEE_EMPTY, PAYOUT_NOMINEE_TITLE } from "@/lib/i18n/labels";
import {
  fetchNomineeWorkerRefs,
  listActivePayoutNominees,
  PAYOUT_NOMINEE_STALE_DAYS,
} from "@/lib/payroll/payout-nominee";
import { BUTTON_PRIMARY, CARD } from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: PAYOUT_NOMINEE_TITLE };

function maskAccount(acct: string): string {
  return acct.length <= 4 ? acct : `••••${acct.slice(-4)}`;
}

export default async function PayoutNomineesPage() {
  // Spec 320 U3 — widened from PM-only to the procurement + leadership set (the
  // set_/clear_/get_/list DEFINER RPCs re-gate to the same roles; SSOT there).
  const ctx = await requireRole([
    "procurement_manager",
    "project_director",
    "super_admin",
    "procurement",
  ]);
  const supabase = await createClient();
  const nominees = await listActivePayoutNominees(supabase);
  const refs = await fetchNomineeWorkerRefs(nominees.map((n) => n.workerId));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{PAYOUT_NOMINEE_TITLE}</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-meta">
          บัญชีชั่วคราวสำหรับช่างที่ยังไม่มีบัญชีธนาคารของตัวเอง —
          โอนเข้าบัญชีญาติ/เพื่อนพร้อมหนังสือยินยอม
        </p>
        <Link
          href="/settings/payout-nominees/edit"
          className={`w-full ${BUTTON_PRIMARY} text-center`}
        >
          {PAYOUT_NOMINEE_ADD}
        </Link>

        {nominees.length === 0 ? (
          <p className="text-ink-secondary text-sm">{PAYOUT_NOMINEE_EMPTY}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {nominees.map((n) => {
              const ref = refs.get(n.workerId);
              const stale = n.daysActive >= PAYOUT_NOMINEE_STALE_DAYS;
              return (
                <li key={n.workerId} className={`${CARD} flex flex-col gap-2`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-ink text-sm font-semibold">{ref?.name ?? "—"}</p>
                      {ref?.code ? <p className="text-ink-muted text-xs">{ref.code}</p> : null}
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                        stale ? "bg-attn-soft text-attn-ink" : "text-ink-secondary"
                      }`}
                    >
                      บนบัญชีตัวแทน {n.daysActive} วัน
                    </span>
                  </div>
                  <p className="text-ink-secondary text-sm">
                    {n.payeeName} · {n.payeeBankName} {maskAccount(n.accountNumber)}
                  </p>
                  <div className="flex justify-end">
                    <ClearNomineeButton workerId={n.workerId} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
