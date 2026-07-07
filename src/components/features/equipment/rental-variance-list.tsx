// Spec 275 U4 — the rental variance roll-up on /equipment/rentals (read-only,
// money, back office). Per agreement it shows the three reconciled figures
// (committed / charged-to-WP / paid-to-vendor) and the recovery flag. Pure
// presentation — the page computes each RentalVariance via computeRentalVariance
// and feeds it here; no client interactivity, so this stays a Server Component.

import { bahtWithSymbol } from "@/lib/format";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import {
  RENTAL_VARIANCE_CHARGED_LABEL,
  RENTAL_VARIANCE_COMMITTED_LABEL,
  RENTAL_VARIANCE_EMPTY_LABEL,
  RENTAL_VARIANCE_FLAG_LABEL,
  RENTAL_VARIANCE_LABEL,
  RENTAL_VARIANCE_PAID_LABEL,
} from "@/lib/i18n/labels";
import type { RentalRecoveryFlag, RentalVariance } from "@/lib/equipment/rental-variance";

// Token trios (globals.css) — never raw palette. over-recovery = PRC margin (done/
// emerald), under-recovery = PRC loss (danger/red), balanced = neutral.
const FLAG_CHIP: Record<RentalRecoveryFlag, string> = {
  over_recovery: "border-done bg-done/10 text-done-strong",
  under_recovery: "border-danger-edge bg-danger-soft text-danger-ink",
  balanced: "border-edge bg-card text-ink-secondary",
};

export interface AgreementVariance {
  id: string;
  label: string;
  variance: RentalVariance;
}

export function RentalVarianceList({ agreements }: { agreements: AgreementVariance[] }) {
  return (
    <section aria-label={RENTAL_VARIANCE_LABEL}>
      <h2 className={SECTION_HEADING}>{RENTAL_VARIANCE_LABEL}</h2>
      {agreements.length === 0 ? (
        <p className="text-ink-muted text-sm">{RENTAL_VARIANCE_EMPTY_LABEL}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {agreements.map((a) => (
            <li key={a.id} className={CARD}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-ink font-semibold break-words">{a.label}</span>
                <span
                  className={`text-meta shrink-0 rounded-full border px-2 py-0.5 font-semibold ${FLAG_CHIP[a.variance.flag]}`}
                >
                  {RENTAL_VARIANCE_FLAG_LABEL[a.variance.flag]}
                </span>
              </div>
              <dl className="mt-2 flex flex-col gap-1">
                <VarianceRow
                  label={RENTAL_VARIANCE_COMMITTED_LABEL}
                  amount={a.variance.committed}
                />
                <VarianceRow
                  label={RENTAL_VARIANCE_CHARGED_LABEL}
                  amount={a.variance.chargedToWp}
                />
                <VarianceRow label={RENTAL_VARIANCE_PAID_LABEL} amount={a.variance.paidToVendor} />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VarianceRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-secondary text-sm">{label}</dt>
      <dd className="text-ink font-medium">{bahtWithSymbol(amount)}</dd>
    </div>
  );
}
