// Spec G8 (gap G8) — /accounting/journal: the manual general-journal surface over
// the existing post_journal_entry / reverse_journal_entry RPCs (built since spec
// 149, no screen until now). Gated to PM_ROLES — exactly who the RPCs admit
// (pm/super/project_director), NOT ACCOUNTING_ROLES: the journal-POST capability
// is distinct from the accounting-VIEW capability (only super_admin overlaps; that
// is the operator, today's primary user). Reads via the admin client behind the
// gate (journal_entries/lines/gl_accounts are zero-grant under RLS). Server
// Component; the form + reverse controls are the only client leaves.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { SECTION_HEADING } from "@/lib/ui/classes";
import { loadManualJournalData } from "@/lib/accounting/load-manual-journals";
import { ManualJournalForm } from "./manual-journal-form";
import { JournalEntryList } from "./journal-entry-list";

export const metadata = { title: "สมุดรายวันทั่วไป" };

export default async function ManualJournalPage() {
  const ctx = await requireRole(PM_ROLES);
  const admin = createAdminClient();
  const { accounts, entries } = await loadManualJournalData(admin);
  const today = bangkokTodayIso();

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">สมุดรายวันทั่วไป</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>บันทึกรายการใหม่</h2>
        <div className="mb-8">
          <ManualJournalForm accounts={accounts} today={today} />
        </div>

        <h2 className={SECTION_HEADING}>รายการล่าสุด</h2>
        <JournalEntryList entries={entries} />
      </section>
    </PageShell>
  );
}
