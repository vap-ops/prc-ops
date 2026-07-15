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
import { AddRentalFab } from "@/components/features/equipment/add-rental-fab";
import { AddSettlementFab } from "@/components/features/equipment/add-settlement-fab";
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
      .select(
        "id, supplier_id, monthly_rate, rate_period, starts_on, ends_on, note, status, created_at",
      ),
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
  ]);

  const suppliers = supplierRows ?? [];
  const projects = projectRows ?? [];
  // Spec 312: a voided (cancelled) batch is hidden from every surface — the
  // reversed GL + audit row are the history, not a stale card / vendor / agreement.
  const visibleBatches = (batchRows ?? []).filter((b) => b.status !== "cancelled");
  // Spec 280: surface suppliers PRC has rented from before, above the full list.
  const rentalVendorIds = rankRentalVendors(visibleBatches);
  const rentals = buildRentalView(
    visibleBatches.map((b) => ({
      id: b.id,
      supplierId: b.supplier_id ?? "",
      rate: b.monthly_rate,
      ratePeriod: b.rate_period as RentalRatePeriod,
      startsOn: b.starts_on,
      endsOn: b.ends_on,
      note: b.note,
      status: b.status,
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
    visibleBatches.map((b) => ({
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

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/equipment" backLabel="อุปกรณ์">
        <h1 className="text-title text-ink font-bold tracking-tight">{EQUIPMENT_RENTAL_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <RentalManager projects={projects} rentals={rentals} defaultDate={today} />
        <div className="mt-8">
          <RentalSettlementManager settlements={settlements} />
        </div>
      </div>

      {/* Spec 323 U1c — recording moved off the list into two stacked FABs (deal +
          settlement), each opening its form in a bottom sheet. */}
      <AddRentalFab
        suppliers={suppliers}
        suggestedSupplierIds={rentalVendorIds}
        projects={projects}
        defaultDate={today}
      />
      <AddSettlementFab agreements={agreementOptions} defaultDate={today} />
    </PageShell>
  );
}
