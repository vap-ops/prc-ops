// Spec 161 U9 — the Nova shop admin. super_admin only: manage the catalog behind
// the coin sink. shop_items is authenticated-readable, but read via the ADMIN client
// here so inactive items show too; writes go through the SECURITY DEFINER RPCs
// (upsert_shop_item / set_shop_item_active) via the admin component's actions.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { NovaShopAdmin, type ShopItem } from "@/components/features/nova/nova-shop-admin";

export const metadata = { title: "ร้าน Nova" };

export default async function NovaShopPage() {
  const ctx = await requireRole(["super_admin"]);
  const admin = createAdminClient();

  const { data: itemRows } = await admin
    .from("shop_items")
    .select("id, name, price_coins, active")
    .order("sort_order")
    .order("name");

  // numeric comes back as a string from PostgREST — Number() before the client.
  const items: ShopItem[] = (itemRows ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    price_coins: Number(i.price_coins),
    active: i.active,
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/nova" backLabel="Nova">
        <h1 className="text-title text-ink font-bold tracking-tight">ร้าน Nova</h1>
        <p className="text-ink-secondary mt-0.5 text-xs">
          ตั้งราคาสินค้าเป็นเหรียญ · เปิด/ปิดการขาย
        </p>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <NovaShopAdmin items={items} />
      </section>
    </PageShell>
  );
}
