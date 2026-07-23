// Spec 299 U1 — the SA help hub: a re-readable, text-first manual for the non-technical
// site_admin. One accordion card per day-to-day task, ordered by daily use (photos →
// muster → manage; the add-crew card is U2). Content is data (HELP_CARDS); each card is a
// native <details> (zero JS) with an anchor id so a future per-screen "?" can deep-link
// (/sa/help#photos). Gate = the SA home's gate (site_admin/super_admin).

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { SA_SURFACE_ROLES } from "@/lib/auth/role-home";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { HELP_CARDS } from "@/lib/sa/help-content";
import { HelpCard } from "@/components/features/sa/help/help-card";

export const metadata = { title: "คู่มือการใช้งาน" };

export default async function SaHelpPage() {
  await requireRole(SA_SURFACE_ROLES);

  return (
    <PageShell>
      <DetailHeader backHref="/sa" backLabel="กลับ">
        <h1 className="text-ink text-xl font-semibold tracking-tight">คู่มือการใช้งาน</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-3 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          วิธีใช้งานแอปในแต่ละวัน — แตะหัวข้อเพื่อดูขั้นตอน
        </p>
        {HELP_CARDS.map((card) => (
          <HelpCard key={card.id} card={card} />
        ))}
      </section>
    </PageShell>
  );
}
