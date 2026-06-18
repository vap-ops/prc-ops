// Spec 141 U2 — /equipment: the back-office equipment registry (pm/super/
// procurement; the U1 INSERT/UPDATE audience). No money on this surface —
// acquisition_cost/acquired_at stay admin-only, so this reads through the RLS
// server client only. Mirrors /workers' page scaffold.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import {
  EquipmentManager,
  type ManagedEquipmentItem,
} from "@/components/features/equipment/equipment-manager";

export const metadata = { title: "อุปกรณ์" };

export default async function EquipmentPage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const [{ data: itemRows }, { data: categoryRows }, { data: ownerRows }] = await Promise.all([
    supabase
      .from("equipment_items")
      .select("id, name, category_id, owner_id, tracking, asset_tag, quantity, status")
      .order("name", { ascending: true }),
    supabase.from("equipment_categories").select("id, name").order("name", { ascending: true }),
    supabase.from("equipment_owners").select("id, name").order("name", { ascending: true }),
  ]);

  const items: ManagedEquipmentItem[] = itemRows ?? [];

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">อุปกรณ์</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <EquipmentManager items={items} categories={categoryRows ?? []} owners={ownerRows ?? []} />
      </div>
    </PageShell>
  );
}
