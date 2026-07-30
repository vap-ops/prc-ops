// Spec 376 U3 (D3) — ประวัติ, the ช่าง's money record. /technician used to stack
// e-card, QR, assigned work, wage history, bank, consents and receipts on ONE
// scroll page (13 views / 14 days — the portal had no pull, spec 376 §1); U3 gave
// the role a three-tab bar and moved the money half here: รายการรอรับ, the
// wage-payment history, and the bank account.
//
// A tab destination, so NO back chip — the bar (phone) and the HubNav strip
// (desktop) are how a ช่าง moves between หน้าหลัก and ประวัติ. The custom header +
// LogoutButton mirror the หน้าหลัก page (the /portal-style bespoke chrome this
// tier has always had).
//
// Every read is the caller's OWN row on the RLS SESSION client (never admin):
// get_my_worker_profile / get_my_wage_payments self-scope on the workers.user_id
// binding, the receipts + pending-bank + contractor_id reads are RLS-scoped the
// same way. Queries copied from the หน้าหลัก page unchanged. No 'use client' — a
// plain Server Component (the interactive bits are already-'use client' children).

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { WorkerHistorySections } from "@/components/features/portal/worker-history-sections";
import { EmptyNotice } from "@/components/features/common/notices";
import { ViewAsEmptyNote } from "@/components/features/chrome/view-as-empty-note";
import { type PortalReceipt } from "@/components/features/portal/portal-receipts";

export const metadata = { title: "ประวัติ" };

export default async function TechnicianHistoryPage() {
  const { id: uid, role } = await requireRole(["technician"]);
  const supabase = await createClient();

  // Every technician is a bound worker (approve + claim both set
  // workers.user_id), so wp is normally present; the empty branch below is the
  // honest state for an unbound one rather than a blank page.
  const { data: workerProfileRows } = await supabase.rpc("get_my_worker_profile");
  const wp = workerProfileRows?.[0] ?? null;
  const [
    { data: workerPayments },
    { data: receiptRows },
    { data: pendingBankRows },
    { data: ownWorkerRow },
  ] = await Promise.all([
    supabase.rpc("get_my_wage_payments"),
    supabase
      .from("stock_issues")
      .select(
        "id, qty, unit, catalog_items ( base_item, spec_attrs ), work_packages ( code, name )",
      )
      .is("received_at", null)
      .order("issued_at", { ascending: false }),
    supabase.from("worker_bank_change_requests").select("id").eq("status", "pending").limit(1),
    // Spec 328 U3 — is this ช่าง a contractor-tied (pay-exempt) member?
    // Self-scoped RLS read ("workers readable by self (portal)"); tied ⇒ the
    // bank section is hidden (the firm pays them, PRC holds no bank).
    // get_my_worker_profile doesn't return contractor_id, hence the extra read.
    supabase.from("workers").select("contractor_id").eq("user_id", uid).maybeSingle(),
  ]);

  const bankExempt = ownWorkerRow?.contractor_id != null;
  const receipts: PortalReceipt[] = (receiptRows ?? []).map((r) => ({
    id: r.id,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.unit,
    qty: Number(r.qty),
    wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : "",
  }));

  return (
    <PageShell>
      <BottomTabBar role={role} />
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink min-w-0 truncate font-bold tracking-tight">ประวัติ</h1>
          <LogoutButton />
        </div>
      </header>
      <HubNav
        maxWidthClass={PAGE_MAX_W}
        items={hubNavForRole(role) ?? []}
        currentHref="/technician/history"
        role={role}
      />

      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 pt-6 pb-28`}>
        {/* Spec 274 U2 — same mount, same position as /technician, /portal and
            /client. Without it a super_admin viewing-as-technician reads the
            empty branch below as "this ช่าง has no record"; every read on this
            page self-scopes to the CALLER's workers row, so an assumed role
            legitimately has none. Renders null in normal use. */}
        <ViewAsEmptyNote />
        {wp ? (
          <div>
            <WorkerHistorySections
              uid={uid}
              wp={wp}
              payments={workerPayments ?? []}
              receipts={receipts}
              hasPendingBank={(pendingBankRows?.length ?? 0) > 0}
              bankExempt={bankExempt}
            />
          </div>
        ) : (
          <EmptyNotice>ยังไม่มีข้อมูลช่างของคุณ</EmptyNotice>
        )}
      </section>
    </PageShell>
  );
}
