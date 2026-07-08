// Spec 268 — /equipment/rentals: record + list inbound equipment rental deals
// (the spec-146 batches/allocations backend, finally surfaced). MONEY page:
// gated to BACK_OFFICE_ROLES (the exact definer-gate audience), so a
// site_admin session never reaches it (spec 46 / ADR 0055 decision 6). The two
// money tables are zero-authenticated-grant — read via the ADMIN client after
// the gate; owner/project names read via the RLS client.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { RentalManager } from "@/components/features/equipment/rental-manager";
import { RentalSettlementManager } from "@/components/features/equipment/rental-settlement-manager";
import {
  RentalVarianceList,
  type AgreementVariance,
} from "@/components/features/equipment/rental-variance-list";
import {
  buildRentalView,
  rankRentalVendors,
  type RentalRatePeriod,
} from "@/lib/equipment/rental-view";
import {
  buildAgreementOptions,
  currentSettlements,
  type SettlementListItem,
} from "@/lib/equipment/rental-settlement-view";
import {
  computeRentalVariance,
  type RentalVarianceSettlementRow,
  type RentalVarianceUsageRow,
} from "@/lib/equipment/rental-variance";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";
import { EQUIPMENT_RENTAL_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: EQUIPMENT_RENTAL_LABEL };

export default async function EquipmentRentalsPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const admin = createAdminSupabase();
  const [
    { data: supplierRows },
    { data: projectRows },
    { data: batchRows },
    { data: allocationRows },
    { data: settlementRows },
    { data: itemRows },
  ] = await Promise.all([
    // Spec 280: a blacklisted supplier is not an option for a new rental.
    supabase
      .from("suppliers")
      .select("id, name")
      .neq("contact_status", "blacklisted")
      .order("name", { ascending: true }),
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    admin
      .from("equipment_rental_batches")
      .select("id, supplier_id, monthly_rate, rate_period, starts_on, ends_on, note, created_at"),
    admin
      .from("equipment_project_allocations")
      .select("id, batch_id, project_id, starts_on, ends_on")
      .order("starts_on", { ascending: true }),
    // Spec 275 U3 — settlements are a zero-grant money table (admin read behind the
    // page gate). Pull all rows; currentSettlements does the supersede anti-join.
    admin
      .from("rental_settlements")
      .select(
        "id, agreement_id, invoice_no, invoice_date, base_amount, overtime_amount, fees_amount, net_amount, vat_amount, deposit_refunded, deposit_forfeited, method, note, superseded_by, created_at",
      ),
    // Spec 275 U4 — which items belong to which rental agreement (zero-grant money
    // read behind the gate). The usage logs are fetched next, scoped to these items.
    admin.from("equipment_items").select("id, rental_agreement_id"),
  ]);

  // Spec 275 U4 — the charged-to-WP basis. equipment_usage_logs scales with every
  // field check-out, so scope the read to items on a rental agreement rather than
  // scanning the whole table (skip the query entirely when there are none).
  const batchByItem = new Map<string, string>();
  for (const it of itemRows ?? []) {
    if (it.rental_agreement_id) batchByItem.set(it.id, it.rental_agreement_id);
  }
  const rentalItemIds = [...batchByItem.keys()];
  const { data: usageRows } = rentalItemIds.length
    ? await admin
        .from("equipment_usage_logs")
        .select("id, item_id, checked_out_on, checked_in_on, daily_rate_snapshot, superseded_by")
        .in("item_id", rentalItemIds)
    : { data: [] };

  const suppliers = supplierRows ?? [];
  const projects = projectRows ?? [];
  // Spec 280: surface suppliers PRC has rented from before, above the full list.
  const rentalVendorIds = rankRentalVendors(batchRows ?? []);
  const rentals = buildRentalView(
    (batchRows ?? []).map((b) => ({
      id: b.id,
      supplierId: b.supplier_id ?? "",
      rate: b.monthly_rate,
      ratePeriod: b.rate_period as RentalRatePeriod,
      startsOn: b.starts_on,
      endsOn: b.ends_on,
      note: b.note,
      createdAt: b.created_at,
    })),
    (allocationRows ?? []).map((a) => ({
      id: a.id,
      batchId: a.batch_id,
      projectId: a.project_id,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
    })),
    suppliers,
    projects,
  );

  // Spec 275 U3 — the settlement surface: agreement options for the select + the
  // live settlements (supersede anti-join, newest first) for the history/correct.
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
  const agreementOptions = buildAgreementOptions(
    (batchRows ?? []).map((b) => ({
      id: b.id,
      supplierName: supplierNameById.get(b.supplier_id ?? "") ?? "—",
      rate: b.monthly_rate,
      ratePeriod: b.rate_period as RentalRatePeriod,
      startsOn: b.starts_on,
      endsOn: b.ends_on,
    })),
  );
  const agreementLabelById = new Map(agreementOptions.map((o) => [o.id, o.label]));
  const settlements: SettlementListItem[] = currentSettlements(
    (settlementRows ?? []).map((r) => ({ ...r, supersededBy: r.superseded_by })),
  )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .map((r) => ({
      id: r.id,
      agreementId: r.agreement_id,
      agreementLabel: agreementLabelById.get(r.agreement_id) ?? "—",
      invoiceNo: r.invoice_no,
      invoiceDate: r.invoice_date,
      base: r.base_amount,
      overtime: r.overtime_amount,
      fees: r.fees_amount,
      net: r.net_amount,
      vat: r.vat_amount,
      depositRefunded: r.deposit_refunded,
      depositForfeited: r.deposit_forfeited,
      method: r.method,
      note: r.note,
    }));

  const today = bangkokTodayISO();

  // Spec 275 U4 — per-agreement variance roll-up. Charged-to-WP = the agreement's
  // items' current usage × daily_rate_snapshot; paid-to-vendor = its current
  // settlements' net; committed = the batch rate × period. computeRentalVariance
  // does the supersede anti-joins + the flag.
  const usageByBatch = new Map<string, RentalVarianceUsageRow[]>();
  for (const u of usageRows ?? []) {
    const batchId = batchByItem.get(u.item_id);
    if (!batchId) continue;
    const row: RentalVarianceUsageRow = {
      id: u.id,
      supersededBy: u.superseded_by,
      checkedOutOn: u.checked_out_on,
      checkedInOn: u.checked_in_on,
      dailyRateSnapshot: u.daily_rate_snapshot,
    };
    const list = usageByBatch.get(batchId);
    if (list) list.push(row);
    else usageByBatch.set(batchId, [row]);
  }
  const settlementsByAgreement = new Map<string, RentalVarianceSettlementRow[]>();
  for (const r of settlementRows ?? []) {
    const row: RentalVarianceSettlementRow = {
      id: r.id,
      supersededBy: r.superseded_by,
      netAmount: r.net_amount,
    };
    const list = settlementsByAgreement.get(r.agreement_id);
    if (list) list.push(row);
    else settlementsByAgreement.set(r.agreement_id, [row]);
  }
  const agreementVariances: AgreementVariance[] = (batchRows ?? []).map((b) => ({
    id: b.id,
    label: agreementLabelById.get(b.id) ?? "—",
    variance: computeRentalVariance({
      usage: usageByBatch.get(b.id) ?? [],
      settlements: settlementsByAgreement.get(b.id) ?? [],
      committed: {
        rate: b.monthly_rate,
        ratePeriod: b.rate_period as RentalRatePeriod,
        startsOn: b.starts_on,
        endsOn: b.ends_on,
      },
      today,
    }),
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/equipment" backLabel="อุปกรณ์">
        <h1 className="text-title text-ink font-bold tracking-tight">{EQUIPMENT_RENTAL_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <RentalManager
          suppliers={suppliers}
          suggestedSupplierIds={rentalVendorIds}
          projects={projects}
          rentals={rentals}
          defaultDate={today}
        />
        <div className="mt-8">
          <RentalSettlementManager
            agreements={agreementOptions}
            settlements={settlements}
            defaultDate={today}
          />
        </div>
        <div className="mt-8">
          <RentalVarianceList agreements={agreementVariances} />
        </div>
      </div>
    </PageShell>
  );
}
