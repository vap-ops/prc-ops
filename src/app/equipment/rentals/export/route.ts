// Spec 367 U2 — the inbound rental-agreement CSV export.
//
// Gate is BACK_OFFICE_ROLES, the same set as /equipment/rentals itself. The two
// money tables carry zero authenticated grant, so — exactly as the page does —
// the batch rows are read through the ADMIN client after the gate, while the
// owner/supplier NAMES come from the RLS session client.

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import {
  rentalCsvFilename,
  toRentalCsv,
  type RentalExportRow,
} from "@/lib/equipment/rental-export";

const PAGE = 1000;

export async function GET() {
  await requireRole(BACK_OFFICE_ROLES);

  const admin = createAdminClient();
  const supabase = await createServerClient();

  const batches: {
    id: string;
    owner_id: string | null;
    supplier_id: string | null;
    note: string | null;
    monthly_rate: number;
    rate_period: RentalExportRow["ratePeriod"];
    starts_on: string;
    ends_on: string | null;
    min_rental_days: number | null;
    deposit_amount: number;
    deposit_paid_date: string | null;
    status: RentalExportRow["status"];
  }[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("equipment_rental_batches")
      .select(
        "id, owner_id, supplier_id, note, monthly_rate, rate_period, starts_on, ends_on, min_rental_days, deposit_amount, deposit_paid_date, status",
      )
      .order("starts_on", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`rental export read failed: ${error.message}`);
    const page = data ?? [];
    batches.push(...page);
    if (page.length < PAGE) break;
  }

  const [{ data: owners }, { data: suppliers }] = await Promise.all([
    supabase.from("equipment_owners").select("id, name"),
    supabase.from("suppliers").select("id, name"),
  ]);
  const ownerName = new Map((owners ?? []).map((o) => [o.id, o.name]));
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const rows: RentalExportRow[] = batches.map((b) => ({
    id: b.id,
    ownerName: b.owner_id ? (ownerName.get(b.owner_id) ?? null) : null,
    supplierName: b.supplier_id ? (supplierName.get(b.supplier_id) ?? null) : null,
    note: b.note,
    // The column is named monthly_rate but carries whatever rate_period says —
    // it predates the daily option (spec 268). The export exposes both together
    // so a reader is never left guessing which period a bare number is in.
    rate: b.monthly_rate,
    ratePeriod: b.rate_period,
    startsOn: b.starts_on,
    endsOn: b.ends_on,
    minRentalDays: b.min_rental_days,
    depositAmount: b.deposit_amount,
    depositPaidDate: b.deposit_paid_date,
    status: b.status,
  }));

  return new NextResponse(toRentalCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${rentalCsvFilename(bangkokTodayIso())}"`,
      "Cache-Control": "no-store",
    },
  });
}
