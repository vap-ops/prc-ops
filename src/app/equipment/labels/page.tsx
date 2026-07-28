// Spec 370 U3 — /equipment/labels: the printable QR sticker sheet. Back-office
// only (sticker printing is registry curation, matching the equipment_items
// INSERT/UPDATE audience); the SA consumes the stickers, not this page. The
// QR payload is the scan deep link; the same URL is what an NFC NDEF sticker
// gets written with (docs/automations.md).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { clientEnv } from "@/lib/env";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { safeBackHref } from "@/lib/nav/back-href";
import {
  EquipmentLabelSheet,
  type LabelItem,
} from "@/components/features/equipment/equipment-label-sheet";

export const metadata = { title: "พิมพ์สติกเกอร์อุปกรณ์" };

export default async function EquipmentLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("equipment_items")
    .select("id, name, serial_no, asset_tag")
    .order("name")
    .limit(1000);

  const items: LabelItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    serialNo: r.serial_no,
    assetTag: r.asset_tag,
  }));

  return (
    <PageShell>
      <div className="print:hidden">
        <BottomTabBar role={ctx.role} />
        <DetailHeader backHref={safeBackHref(from, "/equipment")} backLabel="กลับ">
          <h1 className="text-title text-ink font-bold tracking-tight">พิมพ์สติกเกอร์อุปกรณ์</h1>
        </DetailHeader>
      </div>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6 print:max-w-none print:p-0`}>
        <EquipmentLabelSheet items={items} appOrigin={clientEnv.NEXT_PUBLIC_APP_URL} />
      </div>
    </PageShell>
  );
}
