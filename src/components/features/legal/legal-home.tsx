// Spec 284 U5 / ADR 0080 — the Legal role's home content. Pure view: two entry
// cards (สัญญา, เอกสารรออนุมัติ), each carrying its live count. The /legal Server
// Component wraps this in PageShell + BottomTabBar + DetailHeader after
// requireRole(LEGAL_ROLES) + admin-client counts (contracts / document_approvals
// are zero-grant — read via the admin client, never RLS; spec 46 posture).

import Link from "next/link";
import { ChevronRight, FileText, Stamp, type LucideIcon } from "lucide-react";
import { CONTRACTS_LABEL, LEGAL_APPROVALS_LABEL } from "@/lib/i18n/labels";

interface LegalHomeProps {
  activeContracts: number;
  pendingApprovals: number;
}

interface Entry {
  href: string;
  label: string;
  hint: string;
  count: number;
  Icon: LucideIcon;
}

export function LegalHome({ activeContracts, pendingApprovals }: LegalHomeProps) {
  const entries: ReadonlyArray<Entry> = [
    {
      href: "/legal/contracts",
      label: CONTRACTS_LABEL,
      hint: "มีผลบังคับ",
      count: activeContracts,
      Icon: FileText,
    },
    {
      href: "/legal/approvals",
      label: LEGAL_APPROVALS_LABEL,
      hint: "รอการพิจารณา",
      count: pendingApprovals,
      Icon: Stamp,
    },
  ];

  return (
    <nav className="flex flex-col gap-3">
      {entries.map(({ href, label, hint, count, Icon }) => (
        <Link
          key={href}
          href={href}
          className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-card shadow-card flex items-center gap-4 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
        >
          <Icon aria-hidden className="text-ink-secondary h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="text-ink text-body block font-semibold">{label}</span>
            <span className="text-ink-secondary text-meta block">{hint}</span>
          </span>
          <span className="text-ink shrink-0 text-2xl font-bold tabular-nums">{count}</span>
          <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
        </Link>
      ))}
    </nav>
  );
}
