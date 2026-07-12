// Spec 310 — company-card registry (บัตรเครดิตบริษัท), super_admin only.
// Superadmin records which company card belongs to whom; the holder becomes the
// reimburse-target for any expense paid on that card. No full card number is
// stored (label + holder + optional last-4 only).

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { CardRegistry } from "@/components/features/expenses/card-registry";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { listAssignableHolders, listCompanyCards } from "@/lib/expenses/load-office-expenses";
import { CARD_REGISTRY_LABEL } from "@/lib/i18n/labels";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: CARD_REGISTRY_LABEL };

export default async function CardsPage() {
  await requireRole(["super_admin"]);
  const supabase = await createClient();

  const [cards, holders] = await Promise.all([
    listCompanyCards(supabase),
    listAssignableHolders(supabase),
  ]);

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{CARD_REGISTRY_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        <CardRegistry cards={cards} holders={holders} />
      </section>
    </PageShell>
  );
}
