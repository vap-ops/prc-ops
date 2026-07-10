// Spec 284 U5 / ADR 0080 — /legal/contracts: the contracts surface. requireRole(
// LEGAL_ROLES); rows are read via the admin client (contracts is zero-grant — spec
// 46 posture). A deep-linkable ?status= facet narrows the list (mirrors the
// existing status facets elsewhere). The create form relays U3's createContract; a
// row drills into the [contractId] detail (attachments + void).

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { LEGAL_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { SECTION_HEADING } from "@/lib/ui/classes";
import { baht } from "@/lib/format";
import type { ContractStatus } from "@/lib/db/enums";
import {
  CONTRACTS_LABEL,
  CONTRACT_STATUS_LABEL,
  CONTRACT_TYPE_LABEL,
  CONTRACT_COUNTERPARTY_LABEL,
} from "@/lib/i18n/labels";
import {
  ContractCreateForm,
  type ProjectOption,
} from "@/components/features/legal/contract-create-form";
import { withBackFrom } from "@/lib/nav/back-href";

export const metadata = { title: "สัญญา" };

const STATUSES = Object.keys(CONTRACT_STATUS_LABEL) as ReadonlyArray<ContractStatus>;
const isStatus = (s: string | undefined): s is ContractStatus =>
  !!s && (STATUSES as ReadonlyArray<string>).includes(s);

interface ContractsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ContractsPage({ searchParams }: ContractsPageProps) {
  const ctx = await requireRole(LEGAL_ROLES);
  const { status } = await searchParams;
  const filter = isStatus(status) ? status : null;

  const admin = createAdminClient();
  const [{ data: contractRows }, { data: projectRows }] = await Promise.all([
    admin
      .from("contracts")
      .select(
        "id, title, counterparty_name, counterparty_type, contract_type, status, agreed_amount, created_at",
      )
      .order("created_at", { ascending: false }),
    admin.from("projects").select("id, code, name").order("name"),
  ]);

  const all = contractRows ?? [];
  const counts = new Map<ContractStatus, number>();
  for (const r of all) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const shown = filter ? all.filter((r) => r.status === filter) : all;

  const projects: ReadonlyArray<ProjectOption> = (projectRows ?? []).map((p) => ({
    id: p.id,
    label: p.name ?? p.code,
  }));

  const chip = (href: string, label: string, active: boolean) => (
    <Link
      key={label}
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "border-action bg-action text-on-fill rounded-control shrink-0 border px-3 py-1.5 text-sm font-semibold whitespace-nowrap"
          : "border-edge bg-card text-ink-secondary hover:bg-sunk rounded-control shrink-0 border px-3 py-1.5 text-sm whitespace-nowrap transition-colors"
      }
    >
      {label}
    </Link>
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/legal" backLabel="ฝ่ายกฎหมาย">
        <h1 className="text-title text-ink font-bold tracking-tight">{CONTRACTS_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto w-full ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>สร้างสัญญาใหม่</h2>
        <ContractCreateForm projects={projects} />

        <h2 className={`${SECTION_HEADING} mt-8`}>รายการสัญญา</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {chip("/legal/contracts", `ทั้งหมด (${all.length})`, filter === null)}
          {STATUSES.map((s) =>
            chip(
              `/legal/contracts?status=${s}`,
              `${CONTRACT_STATUS_LABEL[s]} (${counts.get(s) ?? 0})`,
              filter === s,
            ),
          )}
        </div>

        {shown.length === 0 ? (
          <EmptyNotice>ยังไม่มีสัญญา</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((c) => (
              <li key={c.id}>
                <Link
                  href={withBackFrom(`/legal/contracts/${c.id}`, "/legal/contracts")}
                  className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-card shadow-card flex items-center gap-3 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
                >
                  <span className="min-w-40 flex-1">
                    <span className="text-ink text-body block font-semibold">{c.title}</span>
                    <span className="text-ink-secondary text-meta block">
                      {c.counterparty_name} · {CONTRACT_COUNTERPARTY_LABEL[c.counterparty_type]} ·{" "}
                      {CONTRACT_TYPE_LABEL[c.contract_type]}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {c.agreed_amount != null ? (
                      <span className="text-ink text-sm font-medium tabular-nums">
                        {baht(Number(c.agreed_amount))}
                      </span>
                    ) : null}
                    <span className="border-edge text-ink-secondary rounded-full border px-2 py-0.5 text-xs">
                      {CONTRACT_STATUS_LABEL[c.status]}
                    </span>
                    <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
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
