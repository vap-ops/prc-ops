// Spec 184 U2 — the contractor bank-change awareness card on the PM dashboard.
// Presentational (no fetch). Bank-change approvals have no nav surface — they
// live only on a contractor's detail page — so without this card a PM has no way
// to know one is waiting. Exception-driven: renders ONLY when something is
// pending (unlike the always-present รอตรวจ card), linking to the contractor list
// to drill in and decide.

import Link from "next/link";
import { Landmark, ArrowRight } from "lucide-react";

export function BankChangeAwarenessCard({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link
      href="/contacts/subcontractors"
      aria-label={`การเปลี่ยนบัญชี ${count} รายการรอการอนุมัติ`}
      className="border-attn-edge bg-attn-soft shadow-card rounded-card hover:border-attn focus-visible:ring-action flex items-center justify-between gap-3 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <span className="flex items-center gap-2">
        <Landmark aria-hidden className="text-attn-ink size-5 shrink-0" />
        <span className="text-attn-ink text-body">
          <span className="font-bold">{count}</span> การเปลี่ยนบัญชีรอการอนุมัติ
        </span>
      </span>
      <ArrowRight aria-hidden className="text-attn-ink size-5 shrink-0" />
    </Link>
  );
}
