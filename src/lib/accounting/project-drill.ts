// Spec 253 U1 — finance project drill view-model. Assembles the revenue funnel
// (quotation → client PO → contract/งวด → billed → received incl. advances)
// from the pure building blocks (contract.ts งวด rollup + receipts.ts coverage).
// NO business math in components; the drill pages render these models only.
// The slow-contract case is first-class: every slice may be empty while money
// already flows (receipts-only project must look healthy, never broken).

import {
  rollupInstallments,
  installmentSumWarning,
  type InstallmentRow,
  type InstallmentSumWarning,
} from "@/lib/accounting/contract";
import {
  currentReceipts,
  projectReceiptSummary,
  type ReceiptRow,
  type ProjectReceiptSummary,
} from "@/lib/accounting/receipts";

export interface DrillQuotation {
  id: string;
  quotationNo: string;
  amount: number;
  quoteDate: string;
  status: string;
}

export interface DrillClientPo {
  id: string;
  poNo: string;
  amount: number;
  poDate: string;
  quotationId: string | null;
}

export interface DrillContract {
  id: string;
  contractValue: number;
  retentionRate: number;
  signDate: string | null;
}

export interface DrillBilling {
  id: string;
  installmentId: string | null;
  grossAmount: number;
  netReceivable: number | null;
  status: string;
}

export interface RevenueFunnelInput {
  quotations: DrillQuotation[];
  clientPos: DrillClientPo[];
  contract: DrillContract | null;
  installments: InstallmentRow[];
  billings: DrillBilling[];
  receipts: ReceiptRow[];
}

export interface FunnelInstallmentRow extends InstallmentRow {
  billed: number;
  received: number;
}

export interface RevenueFunnel {
  quotations: DrillQuotation[];
  clientPos: DrillClientPo[];
  contract: DrillContract | null;
  installments: FunnelInstallmentRow[];
  billings: DrillBilling[];
  advanceReceipts: ReceiptRow[];
  tiles: ProjectReceiptSummary;
  sumWarning: InstallmentSumWarning | null;
}

// --------------------------------------------------------------------------
// Spec 253 U2 — committed vs actual material split. Committed = bought but not
// yet arrived (purchased/on_route); actual = arrived/spent (delivered/
// site_purchased). Store-routed PRs are excluded entirely (their cost counts at
// เบิก — sumStoreIssues, the dashboard's no-double-count rule). NULL-amount
// spend PRs are the disclosed blind spot ("รอราคา N รายการ"), never silently 0.
const COMMITTED_STATUSES: ReadonlySet<string> = new Set(["purchased", "on_route"]);
const ACTUAL_STATUSES: ReadonlySet<string> = new Set(["delivered", "site_purchased"]);

export interface MaterialSpendSplit {
  committed: number;
  actualPurchases: number;
  awaitingPriceCount: number;
}

export function splitMaterialSpend(
  prs: ReadonlyArray<{ id: string; status: string; amount: number | null }>,
  storedPrIds: ReadonlySet<string>,
): MaterialSpendSplit {
  let committed = 0;
  let actualPurchases = 0;
  let awaitingPriceCount = 0;
  for (const pr of prs) {
    if (storedPrIds.has(pr.id)) continue;
    const isCommitted = COMMITTED_STATUSES.has(pr.status);
    const isActual = ACTUAL_STATUSES.has(pr.status);
    if (!isCommitted && !isActual) continue;
    if (pr.amount === null) {
      awaitingPriceCount += 1;
      continue;
    }
    if (isCommitted) committed += pr.amount;
    else actualPurchases += pr.amount;
  }
  return { committed, actualPurchases, awaitingPriceCount };
}

export function assembleRevenueFunnel(input: RevenueFunnelInput): RevenueFunnel {
  const live = currentReceipts(input.receipts);

  // Per-งวด billed comes from the contract.ts rollup; received threads through
  // the งวด's billings (a receipt belongs to a billing; a billing may claim a งวด).
  const billedRows = rollupInstallments(
    input.installments,
    input.billings.map((b) => ({
      id: b.id,
      installmentId: b.installmentId,
      grossAmount: b.grossAmount,
      status: b.status,
    })),
  );
  const receivedByBilling = new Map<string, number>();
  for (const r of live) {
    if (r.billingId === null) continue;
    receivedByBilling.set(r.billingId, (receivedByBilling.get(r.billingId) ?? 0) + (r.amount ?? 0));
  }
  const installments: FunnelInstallmentRow[] = billedRows.map((row) => ({
    ...row,
    received: input.billings
      .filter((b) => b.installmentId === row.id)
      .reduce((acc, b) => acc + (receivedByBilling.get(b.id) ?? 0), 0),
  }));

  const tiles = projectReceiptSummary(
    input.billings.map((b) => ({ id: b.id, netReceivable: b.netReceivable, status: b.status })),
    input.receipts,
  );

  return {
    quotations: input.quotations,
    clientPos: input.clientPos,
    contract: input.contract,
    installments,
    billings: input.billings,
    advanceReceipts: live.filter((r) => r.billingId === null),
    tiles,
    sumWarning: input.contract
      ? installmentSumWarning(input.contract.contractValue, input.installments)
      : null,
  };
}
