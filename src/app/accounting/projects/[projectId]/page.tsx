// Spec 253 U1 — finance project drill: the revenue funnel for ONE project
// (quotation → client PO → contract + งวดเบิก → billed → received incl.
// advances). Server Component; money read via the admin client behind the
// MONEY_VIEW_ROLES gate (spec 252 posture — accounting has no RLS arms).
// Write affordances render for the PM tier only. Empty states are first-class:
// the slow-contract case means receipts can exist while every document block
// is empty — nothing may look broken.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { MONEY_VIEW_ROLES, PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { formatThaiDate, RECEIPT_METHOD_LABEL } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import { assembleRevenueFunnel, splitMaterialSpend } from "@/lib/accounting/project-drill";
import type { ReceiptRow } from "@/lib/accounting/receipts";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { aggregateLaborCost, type CostInputRow } from "@/lib/labor/cost";
import { sumStoreIssues, sumStoreReturns, sumStorePool } from "@/lib/dashboard/spend";
import {
  QuotationSheet,
  ClientPoSheet,
  ContractSheet,
  InstallmentSheet,
  AdvanceReceiptSheet,
} from "../revenue-forms";

export const metadata = { title: "การเงินโครงการ" };

const QUOTATION_STATUS_LABEL: Record<string, string> = {
  draft: "ร่าง",
  sent: "ส่งแล้ว",
  accepted: "ลูกค้าตกลง",
  rejected: "ไม่ผ่าน",
};

const BILLING_STATUS_LABEL: Record<string, string> = {
  draft: "ร่าง",
  submitted: "ยื่นแล้ว",
  certified: "รับรองแล้ว",
  invoiced: "วางบิลแล้ว",
  paid: "รับเงินแล้ว",
};

export default async function FinanceProjectDrillPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireRole(MONEY_VIEW_ROLES);
  const { projectId } = await params;
  const canWrite = PM_ROLES.includes(ctx.role);
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  // All money reads in one wave — independent tables, no waterfall.
  const [quotationRes, poRes, contractRes, billingRes, receiptRes] = await Promise.all([
    admin
      .from("quotations")
      .select("id, quotation_no, amount, quote_date, status")
      .eq("project_id", projectId)
      .order("quote_date"),
    admin
      .from("client_pos")
      .select("id, po_no, amount, po_date, quotation_id")
      .eq("project_id", projectId)
      .order("po_date"),
    admin
      .from("project_contracts")
      .select("id, contract_value, retention_rate, contract_no, sign_date")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin
      .from("client_billings")
      .select("id, billing_no, installment_id, gross_amount, net_receivable, status")
      .eq("project_id", projectId)
      .order("billing_no"),
    admin
      .from("client_receipts")
      .select("id, client_billing_id, amount, received_date, method, superseded_by")
      .eq("project_id", projectId)
      .order("received_date"),
  ]);

  const contract = contractRes.data;
  const { data: installmentRows } = contract
    ? await admin
        .from("contract_installments")
        .select("id, seq, label, amount, planned_date")
        .eq("contract_id", contract.id)
        .order("seq")
    : { data: [] };

  const receipts: (ReceiptRow & { method: string | null })[] = (receiptRes.data ?? []).map((r) => ({
    id: r.id,
    billingId: r.client_billing_id,
    amount: r.amount === null ? null : Number(r.amount),
    receivedDate: r.received_date,
    supersededBy: r.superseded_by,
    method: r.method,
  }));

  const funnel = assembleRevenueFunnel({
    quotations: (quotationRes.data ?? []).map((q) => ({
      id: q.id,
      quotationNo: q.quotation_no,
      amount: Number(q.amount),
      quoteDate: q.quote_date,
      status: q.status,
    })),
    clientPos: (poRes.data ?? []).map((p) => ({
      id: p.id,
      poNo: p.po_no,
      amount: Number(p.amount),
      poDate: p.po_date,
      quotationId: p.quotation_id,
    })),
    contract: contract
      ? {
          id: contract.id,
          contractValue: Number(contract.contract_value),
          retentionRate: Number(contract.retention_rate),
          signDate: contract.sign_date,
        }
      : null,
    installments: (installmentRows ?? []).map((i) => ({
      id: i.id,
      seq: i.seq,
      label: i.label,
      amount: Number(i.amount),
      plannedDate: i.planned_date,
    })),
    billings: (billingRes.data ?? []).map((b) => ({
      id: b.id,
      installmentId: b.installment_id,
      grossAmount: Number(b.gross_amount),
      netReceivable: b.net_receivable === null ? null : Number(b.net_receivable),
      status: b.status,
    })),
    receipts,
  });

  const billingNoById = new Map((billingRes.data ?? []).map((b) => [b.id, b.billing_no]));
  const nextSeq = funnel.installments.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
  // Current-state receipts for display (anti-join over the supersede chain),
  // computed once (review nit: was filtered twice inline).
  const supersededReceiptIds = new Set(receipts.map((n) => n.supersededBy).filter(Boolean));
  const liveReceipts = receipts.filter((r) => r.amount !== null && !supersededReceiptIds.has(r.id));

  // ------------------------------------------------------------------ COST
  // Same read shapes as the dashboard money block (spec 100/230), scoped to
  // ONE project. Store issues at cost, netted of returns; PR spend split into
  // committed (bought, not arrived) vs actual (arrived/spent) — the operator's
  // "what about POs?" answer, with the null-amount blind spot disclosed.
  const { data: wpRows } = await admin
    .from("work_packages")
    .select("id, code, name")
    .eq("project_id", projectId)
    .order("code");
  const wps = wpRows ?? [];
  const wpIds = wps.map((w) => w.id);

  const [laborRes, prRes, issuesRes, reversalsRes, storeReceiptsRes, poolRes, returnsRes] =
    await Promise.all([
      wpIds.length
        ? admin
            .from("labor_logs")
            .select(
              "id, worker_id, work_date, day_fraction, day_rate_snapshot, pay_type_snapshot, worker_name_snapshot, self_logged, superseded_by",
            )
            .in("work_package_id", wpIds)
        : Promise.resolve({ data: [] as CostInputRow[] }),
      wpIds.length
        ? admin.from("purchase_requests").select("id, status, amount").in("work_package_id", wpIds)
        : Promise.resolve({
            data: [] as { id: string; status: string; amount: number | null }[],
          }),
      admin.from("stock_issues").select("id, total_cost").eq("project_id", projectId),
      admin.from("stock_reversals").select("issue_id").not("issue_id", "is", null),
      admin
        .from("stock_receipts")
        .select("purchase_request_id")
        .eq("project_id", projectId)
        .not("purchase_request_id", "is", null),
      admin.from("stock_on_hand").select("total_value").eq("project_id", projectId),
      admin.from("stock_returns").select("total_cost").eq("project_id", projectId),
    ]);

  const labor = aggregateLaborCost((laborRes.data ?? []) as CostInputRow[]);
  const storedPrIds = new Set(
    (storeReceiptsRes.data ?? [])
      .map((r) => r.purchase_request_id)
      .filter((id): id is string => id != null),
  );
  const reversedIssueIds = new Set(
    (reversalsRes.data ?? []).map((r) => r.issue_id).filter((id): id is string => id != null),
  );
  const materialSplit = splitMaterialSpend(prRes.data ?? [], storedPrIds);
  const storeIssueCost = sumStoreIssues(
    (issuesRes.data ?? []).filter((i) => !reversedIssueIds.has(i.id)),
  );
  const storeReturnCost = sumStoreReturns(returnsRes.data ?? []);
  const storePool = sumStorePool(poolRes.data ?? []);
  const materialActual = materialSplit.actualPurchases + storeIssueCost - storeReturnCost;

  // ------------------------------------------------------------------- P&L
  // wp_profit() runs on the USER session (the spec-252 gate admits the money-
  // view set). Per-WP calls — WP counts are small; a gate/consistency error
  // renders a dash, never a crash.
  const supabase = await createServerSupabase();
  const profitRows = await Promise.all(
    wps.map(async (w) => {
      const { data } = await supabase.rpc("wp_profit", { p_wp: w.id });
      const row = Array.isArray(data) ? data[0] : null;
      return {
        id: w.id,
        label: w.name ?? w.code ?? w.id,
        budget: row?.budget === null || row?.budget === undefined ? null : Number(row.budget),
        labor: row ? Number(row.labor_sell) : null,
        materials: row ? Number(row.materials_cost) : null,
        equipment: row ? Number(row.equipment_cost) : null,
        profit: row?.profit === null || row?.profit === undefined ? null : Number(row.profit),
      };
    }),
  );
  const plTotals = profitRows.reduce(
    (acc, r) => ({
      budget: acc.budget + (r.budget ?? 0),
      labor: acc.labor + (r.labor ?? 0),
      materials: acc.materials + (r.materials ?? 0),
      equipment: acc.equipment + (r.equipment ?? 0),
      profit: acc.profit + (r.profit ?? 0),
    }),
    { budget: 0, labor: 0, materials: 0, equipment: 0, profit: 0 },
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting/projects" backLabel="การเงินรายโครงการ">
        <h1 className="text-title text-ink truncate font-bold tracking-tight">
          {project.name ?? project.code}
        </h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* Headline tiles */}
        <div className="grid grid-cols-2 gap-3">
          <div className={CARD}>
            <p className="text-ink-muted text-xs">วางบิลแล้ว (สุทธิ)</p>
            <p className="text-ink text-lg font-bold tabular-nums">{baht(funnel.tiles.billed)}</p>
          </div>
          <div className={CARD}>
            <p className="text-ink-muted text-xs">รับเงินแล้ว</p>
            <p className="text-done-strong text-lg font-bold tabular-nums">
              {baht(funnel.tiles.received)}
            </p>
          </div>
          <div className={CARD}>
            <p className="text-ink-muted text-xs">ค้างรับ</p>
            <p
              className={`text-lg font-bold tabular-nums ${funnel.tiles.outstanding > 0 ? "text-attn-ink" : "text-ink"}`}
            >
              {baht(funnel.tiles.outstanding)}
            </p>
          </div>
          <div className={CARD}>
            <p className="text-ink-muted text-xs">เงินรับล่วงหน้า (ยังไม่ตัดบิล)</p>
            <p className="text-ink text-lg font-bold tabular-nums">{baht(funnel.tiles.advances)}</p>
          </div>
        </div>

        {/* Documents chain */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className={SECTION_HEADING}>เอกสารรายรับ</h2>
            {canWrite ? (
              <div className="flex flex-wrap justify-end gap-2">
                <QuotationSheet projectId={projectId} />
                <ClientPoSheet
                  projectId={projectId}
                  quotations={funnel.quotations.map((q) => ({
                    id: q.id,
                    label: `${q.quotationNo} · ${baht(q.amount)}`,
                  }))}
                />
                <ContractSheet
                  // Server-keyed remount: after an edit lands (router.refresh),
                  // fresh contract values re-seed the client form state instead
                  // of the sheet keeping its last-typed values (review find).
                  key={
                    funnel.contract
                      ? `${funnel.contract.contractValue}-${funnel.contract.retentionRate}`
                      : "new"
                  }
                  projectId={projectId}
                  existing={
                    funnel.contract
                      ? {
                          contractValue: funnel.contract.contractValue,
                          retentionRate: funnel.contract.retentionRate,
                          contractNo: contract?.contract_no ?? null,
                        }
                      : null
                  }
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            <div className={CARD}>
              <p className="text-ink mb-1 text-sm font-semibold">ใบเสนอราคา</p>
              {funnel.quotations.length === 0 ? (
                <p className="text-ink-muted text-xs">ยังไม่มีใบเสนอราคา</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {funnel.quotations.map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-secondary min-w-0 truncate">
                        {q.quotationNo} · {QUOTATION_STATUS_LABEL[q.status] ?? q.status} ·{" "}
                        {formatThaiDate(q.quoteDate)}
                      </span>
                      <span className="text-ink shrink-0 font-semibold tabular-nums">
                        {baht(q.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={CARD}>
              <p className="text-ink mb-1 text-sm font-semibold">PO จากลูกค้า</p>
              {funnel.clientPos.length === 0 ? (
                <p className="text-ink-muted text-xs">ยังไม่มี PO จากลูกค้า</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {funnel.clientPos.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-secondary min-w-0 truncate">
                        {p.poNo} · {formatThaiDate(p.poDate)}
                      </span>
                      <span className="text-ink shrink-0 font-semibold tabular-nums">
                        {baht(p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={CARD}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <p className="text-ink text-sm font-semibold">สัญญา + งวดเบิก</p>
                {canWrite && funnel.contract ? (
                  <InstallmentSheet
                    projectId={projectId}
                    contractId={funnel.contract.id}
                    nextSeq={nextSeq}
                  />
                ) : null}
              </div>
              {!funnel.contract ? (
                <p className="text-ink-muted text-xs">
                  ยังไม่มีสัญญา — เงินรับ/วางบิลยังบันทึกได้ตามปกติ
                </p>
              ) : (
                <>
                  <p className="text-ink-secondary mb-2 text-xs">
                    มูลค่าสัญญา{" "}
                    <span className="text-ink font-semibold tabular-nums">
                      {baht(funnel.contract.contractValue)}
                    </span>{" "}
                    · ประกัน {funnel.contract.retentionRate}%
                    {contract?.sign_date ? ` · เซ็น ${formatThaiDate(contract.sign_date)}` : ""}
                  </p>
                  {funnel.sumWarning ? (
                    <p className="rounded-control border-attn bg-attn-soft text-attn-ink mb-2 border-l-4 px-3 py-2 text-xs font-medium">
                      ยอดรวมงวด ({baht(funnel.sumWarning.sum)}) ไม่เท่ามูลค่าสัญญา (
                      {baht(funnel.sumWarning.contractValue)})
                    </p>
                  ) : null}
                  {funnel.installments.length === 0 ? (
                    <p className="text-ink-muted text-xs">ยังไม่มีงวดเบิก</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {funnel.installments.map((i) => (
                        <li
                          key={i.id}
                          className="rounded-control bg-sunk flex flex-col gap-0.5 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-ink min-w-0 truncate font-medium">{i.label}</span>
                            <span className="text-ink shrink-0 font-semibold tabular-nums">
                              {baht(i.amount)}
                            </span>
                          </div>
                          <p className="text-ink-muted text-xs">
                            วางบิล {baht(i.billed)} · รับแล้ว {baht(i.received)}
                            {i.plannedDate ? ` · กำหนด ${formatThaiDate(i.plannedDate)}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Billings */}
        <div>
          <h2 className={SECTION_HEADING}>งวดวางบิล</h2>
          {funnel.billings.length === 0 ? (
            <p className="text-ink-muted text-sm">ยังไม่มีงวดวางบิล — สร้างได้ที่หน้า งวดงาน</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {funnel.billings.map((b) => (
                <li key={b.id} className={CARD}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-secondary">
                      งวด #{billingNoById.get(b.id) ?? "—"} ·{" "}
                      {BILLING_STATUS_LABEL[b.status] ?? b.status}
                    </span>
                    <span className="text-ink font-semibold tabular-nums">
                      {b.netReceivable === null ? baht(b.grossAmount) : baht(b.netReceivable)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Receipts incl. advances */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className={SECTION_HEADING}>เงินรับ</h2>
            {canWrite ? <AdvanceReceiptSheet projectId={projectId} /> : null}
          </div>
          {liveReceipts.length === 0 ? (
            <p className="text-ink-muted text-sm">ยังไม่มีเงินรับ</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {liveReceipts.map((r) => (
                <li
                  key={r.id}
                  className="rounded-control bg-sunk flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="text-ink-secondary min-w-0 truncate">
                    {r.receivedDate ? formatThaiDate(r.receivedDate) : "—"} ·{" "}
                    {RECEIPT_METHOD_LABEL[r.method as keyof typeof RECEIPT_METHOD_LABEL] ??
                      r.method}
                    {r.billingId === null ? (
                      <span className="text-attn-ink"> · ล่วงหน้า</span>
                    ) : (
                      ` · งวด #${billingNoById.get(r.billingId) ?? "—"}`
                    )}
                  </span>
                  <span className="text-ink shrink-0 font-semibold tabular-nums">
                    {baht(r.amount ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cost */}
        <div>
          <h2 className={SECTION_HEADING}>ต้นทุน</h2>
          <div className="flex flex-col gap-3">
            <div className={CARD}>
              <p className="text-ink mb-1 text-sm font-semibold">ค่าแรง</p>
              <div className="text-ink-secondary flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                <span>
                  พนักงาน{" "}
                  <span className="text-ink font-semibold tabular-nums">{baht(labor.ownCost)}</span>
                </span>
                <span>
                  ช่างรายวัน{" "}
                  <span className="text-ink font-semibold tabular-nums">{baht(labor.dcCost)}</span>
                </span>
                <span>
                  รวม{" "}
                  <span className="text-ink font-semibold tabular-nums">{baht(labor.total)}</span>
                </span>
              </div>
            </div>

            <div className={CARD}>
              <p className="text-ink mb-1 text-sm font-semibold">ค่าวัสดุ</p>
              <div className="text-ink-secondary flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                <span>
                  สั่งซื้อแล้ว (ยังไม่ถึง){" "}
                  <span className="text-attn-ink font-semibold tabular-nums">
                    {baht(materialSplit.committed)}
                  </span>
                </span>
                <span>
                  ใช้จริงในงาน{" "}
                  <span className="text-ink font-semibold tabular-nums">
                    {baht(materialActual)}
                  </span>
                </span>
                <span>
                  พักในคลังโครงการ{" "}
                  <span className="text-ink font-semibold tabular-nums">{baht(storePool)}</span>
                </span>
              </div>
              {materialSplit.awaitingPriceCount > 0 ? (
                <p className="text-ink-muted mt-1 text-xs">
                  รอราคา {materialSplit.awaitingPriceCount} รายการ (ยังไม่รวมในตัวเลข)
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* P&L per WP */}
        <div>
          <h2 className={SECTION_HEADING}>กำไร-ขาดทุนรายงาน (WP)</h2>
          {profitRows.length === 0 ? (
            <p className="text-ink-muted text-sm">ยังไม่มีงานในโครงการ</p>
          ) : (
            <div className="border-edge bg-card shadow-card rounded-card [touch-action:pan-x_pinch-zoom] overflow-x-auto border">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr className="text-ink-muted border-edge border-b text-left">
                    <th className="px-3 py-2 font-medium">งาน</th>
                    <th className="px-3 py-2 text-right font-medium">งบ</th>
                    <th className="px-3 py-2 text-right font-medium">ค่าแรง</th>
                    <th className="px-3 py-2 text-right font-medium">วัสดุ</th>
                    <th className="px-3 py-2 text-right font-medium">อุปกรณ์</th>
                    <th className="px-3 py-2 text-right font-medium">กำไร</th>
                  </tr>
                </thead>
                <tbody>
                  {profitRows.map((r) => (
                    <tr key={r.id} className="border-edge border-b last:border-0">
                      <td className="text-ink max-w-40 truncate px-3 py-2">{r.label}</td>
                      <td className="text-ink px-3 py-2 text-right tabular-nums">
                        {r.budget === null ? "—" : baht(r.budget)}
                      </td>
                      <td className="text-ink px-3 py-2 text-right tabular-nums">
                        {r.labor === null ? "—" : baht(r.labor)}
                      </td>
                      <td className="text-ink px-3 py-2 text-right tabular-nums">
                        {r.materials === null ? "—" : baht(r.materials)}
                      </td>
                      <td className="text-ink px-3 py-2 text-right tabular-nums">
                        {r.equipment === null ? "—" : baht(r.equipment)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          r.profit !== null && r.profit < 0 ? "text-danger" : "text-ink"
                        }`}
                      >
                        {r.profit === null ? "—" : baht(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-edge border-t">
                    <td className="text-ink px-3 py-2 font-semibold">รวม</td>
                    <td className="text-ink px-3 py-2 text-right font-semibold tabular-nums">
                      {baht(plTotals.budget)}
                    </td>
                    <td className="text-ink px-3 py-2 text-right font-semibold tabular-nums">
                      {baht(plTotals.labor)}
                    </td>
                    <td className="text-ink px-3 py-2 text-right font-semibold tabular-nums">
                      {baht(plTotals.materials)}
                    </td>
                    <td className="text-ink px-3 py-2 text-right font-semibold tabular-nums">
                      {baht(plTotals.equipment)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        plTotals.profit < 0 ? "text-danger" : "text-ink"
                      }`}
                    >
                      {baht(plTotals.profit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}
