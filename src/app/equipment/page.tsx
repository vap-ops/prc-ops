// Spec 141 U2 — /equipment: the back-office equipment registry (pm/super/
// procurement; the U1 INSERT/UPDATE audience). No money on this surface —
// acquisition_cost/acquired_at stay admin-only, so this reads through the RLS
// server client only. Mirrors /workers' page scaffold.

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { EQUIPMENT_EXPORT_LABEL, EQUIPMENT_RENTAL_LABEL } from "@/lib/i18n/labels";
import { ImportEquipmentSheet } from "@/components/features/equipment/import-equipment-sheet";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES, EQUIPMENT_MOVE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { safeBackHref } from "@/lib/nav/back-href";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { EQUIPMENT_IMAGES_BUCKET } from "@/lib/storage/buckets";
import type { EquipmentPhotoKind } from "@/lib/equipment/photo-kinds";
import {
  EquipmentManager,
  type ManagedEquipmentItem,
  type EquipmentMovementRow,
} from "@/components/features/equipment/equipment-manager";

export const metadata = { title: "อุปกรณ์" };

// Nav-coherence audit 2026-07: multi-parent (settings hub · /procurement Resources
// tile) — back chip resolves ?from, else /settings.
export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  // U5 — site_admin reaches the field view; only back office edits the registry.
  const ctx = await requireRole(EQUIPMENT_MOVE_ROLES);
  const canManageRegistry = BACK_OFFICE_ROLES.includes(ctx.role);

  const supabase = await createServerSupabase();
  const [
    { data: itemRows },
    { data: categoryRows },
    { data: ownerRows },
    { data: projectRows },
    { data: movementRows },
    { data: skuRows },
  ] = await Promise.all([
    supabase
      .from("equipment_items")
      // image_path (spec 367 U1) rides along for U5's per-item thumbnails; it is
      // a storage path, so it never reaches the client — only the signed URL does.
      // equipment_catalog_item_id (spec 385 U2) drives the add sheet's No.<n+1>
      // preview and the bulk one-row rule.
      .select(
        "id, name, category_id, owner_id, tracking, asset_tag, quantity, status, equipment_catalog_item_id",
      )
      .order("name", { ascending: true }),
    supabase.from("equipment_categories").select("id, name").order("name", { ascending: true }),
    // is_default (mig …_075881_) drives the add form's preselected owner. The
    // column carries its own SELECT grant — equipment_owners is column-granted,
    // so an ungranted column makes PostgREST refuse the WHOLE read, not return
    // null.
    supabase
      .from("equipment_owners")
      .select("id, name, is_default")
      .order("name", { ascending: true }),
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase
      .from("equipment_movements")
      .select("item_id, kind, project_id, occurred_at")
      .order("occurred_at", { ascending: false }),
    // Spec 385 U2 — the ทะเบียน the add sheet picks from. COLUMN-PROJECTED on
    // purpose: equipment_catalog_items is column-granted and default_daily_rate
    // has NO authenticated grant, so a select("*") would refuse the whole read
    // (the worker_level_rates class). The wall stays on the money column; this
    // page never touches it.
    supabase
      .from("equipment_catalog_items")
      .select("id, name, category_id, brand, model, default_tracking")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const items: ManagedEquipmentItem[] = itemRows ?? [];

  // Spec 382 U2 — the four slots per item, with 120s signed thumbnails.
  // equipment-images is private and storage SELECT RLS does not cover these reads;
  // the authorisation is the row-level SELECT the caller already passed above (the
  // mintSignedUrls contract, ADR 0015/0026/0028).
  //
  // The KIND list and the URL map are kept separate on purpose: the n/4 chip counts
  // kinds, so a slot whose signed URL failed to mint still reads as filled instead
  // of silently dropping out of the count.
  const { data: photoRows } = await supabase
    .from("equipment_item_photos")
    .select("id, item_id, kind, storage_path");
  const photoUrlMap = await mintSignedUrls(
    EQUIPMENT_IMAGES_BUCKET,
    (photoRows ?? []).map((r) => ({ id: r.id, storage_path: r.storage_path })),
  );
  const photosByItem: Record<string, { kind: EquipmentPhotoKind; url?: string }[]> = {};
  for (const row of photoRows ?? []) {
    const url = photoUrlMap.get(row.id);
    (photosByItem[row.item_id] ??= []).push({
      kind: row.kind,
      ...(url ? { url } : {}),
    });
  }
  const movements: EquipmentMovementRow[] = (movementRows ?? []).map((m) => ({
    itemId: m.item_id,
    kind: m.kind,
    projectId: m.project_id,
    occurredAt: m.occurred_at,
  }));

  // Spec 202 U1 — the per-item daily charge-out rate is money (zero authenticated
  // grant, ADR 0055 decision 6), so it is read ONLY for the back-office money
  // audience (canManageRegistry) and ONLY via the admin client. The site_admin
  // field view never gets the map, so no rate reaches that client (spec 46).
  let dailyRates: Record<string, number | null> | undefined;
  if (canManageRegistry) {
    const admin = createAdminSupabase();
    const { data: rateRows } = await admin.from("equipment_items").select("id, daily_rate");
    dailyRates = Object.fromEntries((rateRows ?? []).map((r) => [r.id, r.daily_rate]));
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/settings")} backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">อุปกรณ์</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          {/* Spec 370 U2/U4 — the scan door (whole page audience ==
              EQUIPMENT_MOVE_ROLES == the scan page's own gate). */}
          <Link
            href="/equipment/scan?from=%2Fequipment"
            className="text-action inline-flex min-h-11 items-center text-sm font-medium"
          >
            สแกนยืม/คืน →
          </Link>
          {/* Spec 268: the rental recorder is a money surface — linked for the
              back-office audience only (the site_admin view stays rate-free). */}
          {canManageRegistry && (
            <Link
              href="/equipment/rentals"
              className="text-action inline-flex min-h-11 items-center text-sm font-medium"
            >
              {EQUIPMENT_RENTAL_LABEL} →
            </Link>
          )}
          {/* Spec 367 U2 — a plain <a download>, NOT next/link: Link PREFETCHES,
              and prefetching a route handler EXECUTES it (proven live, spec 358
              U4), so every hover would build and discard a CSV. The route
              re-gates itself and drops the money columns for a non-money
              audience, so this is safe to show to the whole page audience. */}
          <a
            href="/equipment/export"
            download
            className="text-action inline-flex min-h-11 items-center text-sm font-medium"
          >
            {EQUIPMENT_EXPORT_LABEL}
          </a>
          {/* Spec 370 U3 — sticker printing is registry curation (back office);
              the SA consumes stickers via the scan door above. */}
          {canManageRegistry && (
            <Link
              href="/equipment/labels?from=%2Fequipment"
              className="text-action inline-flex min-h-11 items-center text-sm font-medium"
            >
              พิมพ์สติกเกอร์ QR
            </Link>
          )}
          {/* Spec 367 U3b — import writes, so it is back-office only, matching
              the equipment_items INSERT/UPDATE policies and the action gate. */}
          {canManageRegistry && <ImportEquipmentSheet />}
        </div>
        <EquipmentManager
          items={items}
          catalogSkus={(skuRows ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            categoryId: s.category_id,
            brand: s.brand,
            model: s.model,
            defaultTracking: s.default_tracking,
          }))}
          categories={categoryRows ?? []}
          owners={(ownerRows ?? []).map((o) => ({
            id: o.id,
            name: o.name,
            isDefault: o.is_default,
          }))}
          projects={projectRows ?? []}
          movements={movements}
          canManageRegistry={canManageRegistry}
          {...(dailyRates ? { dailyRates } : {})}
          {...(Object.keys(photosByItem).length > 0 ? { photosByItem } : {})}
        />
      </div>
    </PageShell>
  );
}
