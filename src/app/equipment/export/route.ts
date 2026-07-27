// Spec 367 U2 — the equipment registry CSV export.
//
// Gate is EQUIPMENT_MOVE_ROLES, the SAME set as /equipment itself: a role that
// can see the registry can export exactly what it sees, and no other role can
// reach either. The money split then mirrors the page's own `canManageRegistry`
// — BACK_OFFICE_ROLES — so the file and the screen can never disagree about who
// sees a price (the spec 187 affordance-then-refuse bug is the counter-example).
//
// Non-money columns read through the RLS SESSION client, so the export cannot
// widen what its viewer may read. The two money columns are read through the
// admin client ONLY after the money gate passes, exactly as the page does
// (ADR 0055 decision 6 — they carry zero authenticated grant, so the session
// client physically cannot return them).

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES, EQUIPMENT_MOVE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { currentEquipmentLocation } from "@/lib/equipment/current-location";
import { equipmentLocationLabel } from "@/lib/equipment/equipment-location-label";
import {
  equipmentCsvFilename,
  toEquipmentCsv,
  type EquipmentExportRow,
} from "@/lib/equipment/equipment-export";

// PostgREST's db-max-rows on this project is 1000. 64 items today, but a
// store-wide transfer schedule is exactly the thing that grows, and a silent
// truncation would hand a sister company an INCOMPLETE list of what it bought.
const PAGE = 1000;

export async function GET() {
  const ctx = await requireRole(EQUIPMENT_MOVE_ROLES);
  const includeMoney = BACK_OFFICE_ROLES.includes(ctx.role);

  const supabase = await createServerClient();

  const items: {
    id: string;
    name: string;
    category_id: string;
    owner_id: string;
    supplier_id: string | null;
    brand: string | null;
    model: string | null;
    serial_no: string | null;
    asset_tag: string | null;
    tracking: EquipmentExportRow["tracking"];
    quantity: number | null;
    condition: EquipmentExportRow["condition"];
    status: EquipmentExportRow["status"];
    description: string | null;
    image_path: string | null;
  }[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("equipment_items")
      .select(
        "id, name, category_id, owner_id, supplier_id, brand, model, serial_no, asset_tag, tracking, quantity, condition, status, description, image_path",
      )
      .order("name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`equipment export read failed: ${error.message}`);
    const page = data ?? [];
    items.push(...page);
    if (page.length < PAGE) break;
  }

  const [
    { data: categories },
    { data: owners },
    { data: suppliers },
    { data: projects },
    { data: movements },
  ] = await Promise.all([
    supabase.from("equipment_categories").select("id, name"),
    supabase.from("equipment_owners").select("id, name"),
    supabase.from("suppliers").select("id, name"),
    supabase.from("projects").select("id, name"),
    supabase
      .from("equipment_movements")
      .select("item_id, kind, project_id, occurred_at")
      .order("occurred_at", { ascending: false }),
  ]);

  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const ownerName = new Map((owners ?? []).map((o) => [o.id, o.name]));
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const locations = currentEquipmentLocation(
    (movements ?? []).map((m) => ({
      itemId: m.item_id,
      kind: m.kind,
      projectId: m.project_id,
      occurredAt: m.occurred_at,
    })),
  );

  // MONEY: admin client, and ONLY behind the gate. Fetched as a map keyed by id
  // so a failure to resolve one leaves that cell blank rather than shifting rows.
  let money: Map<string, { cost: number | null; rate: number | null; acquiredAt: string | null }> =
    new Map();
  if (includeMoney) {
    const admin = createAdminClient();
    const { data: rates } = await admin
      .from("equipment_items")
      .select("id, acquisition_cost, daily_rate, acquired_at");
    money = new Map(
      (rates ?? []).map((r) => [
        r.id,
        { cost: r.acquisition_cost, rate: r.daily_rate, acquiredAt: r.acquired_at },
      ]),
    );
  }

  const rows: EquipmentExportRow[] = items.map((it) => {
    const loc = locations.get(it.id);
    const m = money.get(it.id);
    return {
      id: it.id,
      name: it.name,
      categoryName: categoryName.get(it.category_id) ?? "",
      brand: it.brand,
      model: it.model,
      serialNo: it.serial_no,
      assetTag: it.asset_tag,
      tracking: it.tracking,
      quantity: it.quantity,
      condition: it.condition,
      status: it.status,
      ownerName: ownerName.get(it.owner_id) ?? null,
      supplierName: it.supplier_id ? (supplierName.get(it.supplier_id) ?? null) : null,
      // acquired_at is money-adjacent (it carries no grant either), so it is only
      // present for the money audience — same map, same gate.
      acquiredAt: m?.acquiredAt ?? null,
      acquisitionCost: m?.cost ?? null,
      dailyRate: m?.rate ?? null,
      locationLabel: equipmentLocationLabel(
        loc,
        loc?.projectId ? (projectName.get(loc.projectId) ?? null) : null,
      ),
      description: it.description,
      hasImage: it.image_path !== null,
    };
  });

  return new NextResponse(toEquipmentCsv(rows, { includeMoney }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${equipmentCsvFilename(bangkokTodayIso())}"`,
      "Cache-Control": "no-store",
    },
  });
}
