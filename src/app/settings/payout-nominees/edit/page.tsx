// Spec 320 U2 — add/edit a worker's temporary payout nominee, on its own route
// (edit != the worklist). No ?worker= → a picker of active bankless workers; with
// ?worker=<uuid> → the PayoutNomineeForm, prefilled from any existing active
// nominee. procurement_manager-gated (form action + RPC re-gate).

import Link from "next/link";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PayoutNomineeForm } from "@/components/features/payroll/payout-nominee-form";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAYOUT_NOMINEE_ADD, PAYOUT_NOMINEE_TITLE } from "@/lib/i18n/labels";
import {
  fetchNomineeWorkerRefs,
  getWorkerPayoutNominee,
  listBanklessWorkers,
} from "@/lib/payroll/payout-nominee";
import { CARD } from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { UUID_REGEX } from "@/lib/validate/uuid";

export const metadata = { title: PAYOUT_NOMINEE_ADD };

export default async function EditPayoutNomineePage({
  searchParams,
}: {
  searchParams: Promise<{ worker?: string }>;
}) {
  const ctx = await requireRole(["procurement_manager"]);
  const sp = await searchParams;
  const workerId = typeof sp.worker === "string" && UUID_REGEX.test(sp.worker) ? sp.worker : null;

  if (!workerId) {
    const workers = await listBanklessWorkers();
    return (
      <PageShell>
        <BottomTabBar role={ctx.role} />
        <DetailHeader backHref="/settings/payout-nominees" backLabel="กลับ">
          <h1 className="text-ink text-lg font-semibold">{PAYOUT_NOMINEE_ADD}</h1>
        </DetailHeader>
        <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-3 px-5 py-6`}>
          <p className="text-ink-secondary text-meta">เลือกช่างที่ยังไม่มีบัญชีธนาคารของตัวเอง</p>
          {workers.length === 0 ? (
            <p className="text-ink-secondary text-sm">ไม่มีช่างที่ยังไม่มีบัญชีธนาคาร</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {workers.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/settings/payout-nominees/edit?worker=${w.id}`}
                    className={`${CARD} flex items-center justify-between`}
                  >
                    <span className="text-ink text-sm font-medium">{w.name}</span>
                    {w.code ? <span className="text-ink-muted text-xs">{w.code}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageShell>
    );
  }

  const supabase = await createClient();
  const [existing, refs] = await Promise.all([
    getWorkerPayoutNominee(supabase, workerId),
    fetchNomineeWorkerRefs([workerId]),
  ]);
  const ref = refs.get(workerId);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings/payout-nominees" backLabel="กลับ">
        <h1 className="text-ink text-lg font-semibold">{PAYOUT_NOMINEE_TITLE}</h1>
      </DetailHeader>
      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-3 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          ช่าง: <span className="text-ink font-medium">{ref?.name ?? "—"}</span>
          {ref?.code ? <span className="text-ink-muted"> · {ref.code}</span> : null}
        </p>
        <PayoutNomineeForm
          workerId={workerId}
          initial={
            existing
              ? {
                  payeeName: existing.payeeName,
                  relationship: existing.relationship,
                  bankName: existing.bankName,
                  accountNumber: existing.accountNumber,
                  accountName: existing.accountName,
                }
              : null
          }
        />
      </section>
    </PageShell>
  );
}
