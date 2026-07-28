// Spec 370 U2 — /equipment/scan: the scan-in/out door. QR stickers and NFC
// NDEF tags both carry the deep link (?item=<uuid>); the same screen offers
// the camera and the name/serial search fallback (D2/D3). Gate =
// EQUIPMENT_MOVE_ROLES, the same set /equipment and both RPCs admit.
//
// Reads mirror the store page: items (RLS role-scoped; a viewer without
// equipment access gets an empty set), open loans via the check_out anti-join
// with explicit limits, WP/borrower/recorder names for the return sheet, the
// deployed-project of each item (movements latest-wins) and the leaf WPs of
// projects that hold equipment — the borrow picker's domain.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { EQUIPMENT_MOVE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { safeBackHref } from "@/lib/nav/back-href";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { currentEquipmentLocation } from "@/lib/equipment/current-location";
import {
  EquipmentScanClient,
  type ScanLeafWp,
} from "@/components/features/equipment/equipment-scan-client";
import type { ScanItem, ScanOpenLoan } from "@/lib/equipment/scan-resolve";

export const metadata = { title: "สแกนอุปกรณ์" };

export default async function EquipmentScanPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; from?: string }>;
}) {
  const { item, from } = await searchParams;
  const ctx = await requireRole(EQUIPMENT_MOVE_ROLES);
  const supabase = await createClient();

  const [{ data: itemRows }, { data: moveRows }, { data: loanCandidates }, { data: closingRows }] =
    await Promise.all([
      supabase
        .from("equipment_items")
        .select("id, name, serial_no, asset_tag, tracking")
        .order("name")
        .limit(1000),
      supabase
        .from("equipment_movements")
        .select("item_id, kind, project_id, occurred_at")
        .limit(5000),
      supabase
        .from("equipment_usage_logs")
        .select("id, item_id, work_package_id, checked_out_on, borrower_worker_id, entered_by")
        .is("checked_in_on", null)
        .limit(500),
      supabase
        .from("equipment_usage_logs")
        .select("superseded_by")
        .not("superseded_by", "is", null)
        .limit(5000),
    ]);

  const items: ScanItem[] = (itemRows ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    serialNo: i.serial_no,
    assetTag: i.asset_tag,
    tracking: i.tracking as "unit" | "bulk",
  }));

  const supersededIds = new Set((closingRows ?? []).map((r) => r.superseded_by));
  const open = (loanCandidates ?? []).filter((l) => !supersededIds.has(l.id));

  // Names for the return sheet's context line.
  const wpIds = [...new Set(open.map((l) => l.work_package_id))];
  const borrowerIds = open
    .map((l) => l.borrower_worker_id)
    .filter((id): id is string => id !== null);
  const recorderIds = [...new Set(open.map((l) => l.entered_by))];
  const [{ data: loanWps }, { data: loanWorkers }, recorderNames] = await Promise.all([
    wpIds.length
      ? supabase.from("work_packages").select("id, code, name").in("id", wpIds)
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
    borrowerIds.length
      ? supabase.from("workers").select("id, name").in("id", borrowerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    recorderIds.length
      ? fetchDisplayNames(recorderIds, "equipment-scan-recorders")
      : Promise.resolve(new Map<string, string>()),
  ]);
  const wpById = new Map((loanWps ?? []).map((w) => [w.id, w]));
  const workerName = new Map((loanWorkers ?? []).map((w) => [w.id, w.name]));

  const openLoans: ScanOpenLoan[] = open.map((l) => ({
    logId: l.id,
    itemId: l.item_id,
    wpId: l.work_package_id,
    wpCode: wpById.get(l.work_package_id)?.code ?? "",
    wpName: wpById.get(l.work_package_id)?.name ?? "",
    checkedOutOn: l.checked_out_on,
    holderName:
      (l.borrower_worker_id ? workerName.get(l.borrower_worker_id) : undefined) ??
      recorderNames.get(l.entered_by) ??
      "—",
  }));

  // Each item's deployed project (latest movement wins) → the borrow picker's
  // WP domain is the LEAF WPs of projects that actually hold equipment.
  const location = currentEquipmentLocation(
    (moveRows ?? []).map((m) => ({
      itemId: m.item_id,
      kind: m.kind,
      projectId: m.project_id,
      occurredAt: m.occurred_at,
    })),
  );
  const itemProjects: Record<string, string> = {};
  for (const [itemId, loc] of location) {
    if (loc.kind === "deployed" && loc.projectId) itemProjects[itemId] = loc.projectId;
  }
  const projectIds = [...new Set(Object.values(itemProjects))];
  const { data: wpRows } = projectIds.length
    ? await supabase
        .from("work_packages")
        .select("id, project_id, code, name")
        .in("project_id", projectIds)
        .eq("is_group", false)
        .neq("status", "complete")
        .order("code")
        .limit(2000)
    : { data: [] as { id: string; project_id: string; code: string; name: string }[] };
  const leafWps: ScanLeafWp[] = (wpRows ?? []).map((w) => ({
    id: w.id,
    projectId: w.project_id,
    code: w.code,
    name: w.name,
  }));

  const initialItemId = item && /^[0-9a-f-]{36}$/i.test(item) ? item.toLowerCase() : null;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/equipment")} backLabel="กลับ">
        <h1 className="text-title text-ink font-bold tracking-tight">สแกนอุปกรณ์</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <EquipmentScanClient
          items={items}
          openLoans={openLoans}
          itemProjects={itemProjects}
          leafWps={leafWps}
          initialItemId={initialItemId}
          revalidate="/equipment/scan"
        />
      </div>
    </PageShell>
  );
}
