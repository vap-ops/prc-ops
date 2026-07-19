// Spec 329 §4 — the company documents library (เอกสารบริษัท). Read gate =
// COMPANY_DOC_VIEW_ROLES (back office + accounting + legal); manage controls
// render only for ACCOUNTING_ROLES. Rows via the user-context client (table
// RLS is the gate); download links are short-TTL signed URLs minted here
// server-side (bucket has no SELECT policy — house doctrine).

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { CompanyDocsView } from "@/components/features/company-docs/company-docs-view";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES, COMPANY_DOC_VIEW_ROLES } from "@/lib/auth/role-home";
import { listCompanyDocuments } from "@/lib/company-docs/list-documents";
import { bangkokTodayIso } from "@/lib/dates";
import { COMPANY_DOCS_LABEL } from "@/lib/i18n/labels";
import { COMPANY_DOCS_BUCKET } from "@/lib/storage/buckets";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: "เอกสารบริษัท" };

export default async function CompanyDocsPage() {
  const ctx = await requireRole(COMPANY_DOC_VIEW_ROLES);

  const docs = await listCompanyDocuments();
  const allRows = docs.flatMap((d) => [d.head, ...d.history]);
  const urlMap = await mintSignedUrls(COMPANY_DOCS_BUCKET, allRows);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{COMPANY_DOCS_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <CompanyDocsView
          docs={docs}
          downloadUrls={Object.fromEntries(urlMap)}
          canManage={ACCOUNTING_ROLES.includes(ctx.role)}
          todayIso={bangkokTodayIso()}
        />
      </section>
    </PageShell>
  );
}
