// Spec 320 U2 — add/edit a worker's temporary payout nominee, on its own route
// (edit != the worklist). No ?worker= → a picker of active bankless workers; with
// ?worker=<uuid> → the PayoutNomineeForm, prefilled from any existing active
// nominee. PAYOUT_NOMINEE_ROLES-gated (form action + RPC re-gate).
// Spec 395 U3: the picker is no longer "bankless" — see listNomineeCandidates.

import Link from "next/link";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PayoutNomineeForm } from "@/components/features/payroll/payout-nominee-form";
import { requireRole } from "@/lib/auth/require-role";
import { PAYOUT_NOMINEE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import {
  PAYOUT_NOMINEE_ADD,
  PAYOUT_NOMINEE_PICKER_CAPTION,
  PAYOUT_NOMINEE_PICKER_EMPTY,
  PAYOUT_NOMINEE_REASON_NOT_OWN,
  PAYOUT_NOMINEE_REASON_NO_ACCOUNT,
  PAYOUT_NOMINEE_TITLE,
} from "@/lib/i18n/labels";
import { listNomineeCandidates, loadPayoutAccountAudit } from "@/lib/workers/payout-account-audit";
import { fetchNomineeWorkerRefs, getWorkerPayoutNominee } from "@/lib/payroll/payout-nominee";
import { CARD } from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { UUID_REGEX } from "@/lib/validate/uuid";

export const metadata = { title: PAYOUT_NOMINEE_ADD };

export default async function EditPayoutNomineePage({
  searchParams,
}: {
  searchParams: Promise<{ worker?: string }>;
}) {
  // Spec 320 U3 — widened from PM-only to the procurement + leadership set (RPCs re-gate).
  // Spec 395 §6 — one constant, shared with the list page and matching the RPC gate.
  const ctx = await requireRole(PAYOUT_NOMINEE_ROLES);
  const sp = await searchParams;
  const workerId = typeof sp.worker === "string" && UUID_REGEX.test(sp.worker) ? sp.worker : null;

  if (!workerId) {
    // Spec 395 U3 — the picker used to list ONLY bankless workers, and every worker
    // spec 395 is about HAS an account that simply is not theirs. None of the 8 live
    // cases was selectable here at all; U2's badge could reach them only by deep-link.
    // ⚠️ DEGRADE, NEVER THROW. `loadPayoutAccountAudit` throws by design (for a worklist
    // an empty result is a lie), but this is the REMEDY page: letting the detector's
    // failure 500 it would take spec 320's original bankless population down with it, so
    // the one surface that fixes the problem dies with the thing that detects it.
    const pickerDb = await createClient();
    const assessments = await loadPayoutAccountAudit(pickerDb).catch((e: unknown) => {
      console.error("payout-nominee picker: audit read failed, bankless-only list", e);
      return [];
    });
    const workers = await listNomineeCandidates(assessments);
    return (
      <PageShell>
        <BottomTabBar role={ctx.role} />
        <DetailHeader backHref="/settings/payout-nominees" backLabel="กลับ">
          <h1 className="text-ink text-lg font-semibold">{PAYOUT_NOMINEE_ADD}</h1>
        </DetailHeader>
        <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-3 px-5 py-6`}>
          <p className="text-ink-secondary text-meta">{PAYOUT_NOMINEE_PICKER_CAPTION}</p>
          {workers.length === 0 ? (
            <p className="text-ink-secondary text-sm">{PAYOUT_NOMINEE_PICKER_EMPTY}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {workers.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/settings/payout-nominees/edit?worker=${w.id}`}
                    className={`${CARD} flex items-center justify-between gap-2`}
                  >
                    <span className="text-ink text-sm font-medium">{w.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {/* Why this person is here — the two reasons need different
                          conversations with the ช่าง, so the picker says which. */}
                      <span className="text-ink-secondary text-xs">
                        {w.reason === "no-account"
                          ? PAYOUT_NOMINEE_REASON_NO_ACCOUNT
                          : PAYOUT_NOMINEE_REASON_NOT_OWN}
                      </span>
                      {w.code ? <span className="text-ink-muted text-xs">{w.code}</span> : null}
                    </span>
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
