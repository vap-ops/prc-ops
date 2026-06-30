import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { EmptyNotice } from "@/components/features/common/notices";
import { SECTION_HEADING } from "@/lib/ui/classes";

export const metadata = { title: "การเข้าถึงสิ้นสุดแล้ว" };

// Spec 233 / ADR 0067 — where an expired or revoked client lands. NOT an error
// and NOT /coming-soon: a calm notice. No gate on purpose — a lapsed client
// (still role 'client') must be able to reach it after the /client gate
// forwards here.
export default function ClientAccessEndedPage() {
  return (
    <PageShell>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>การเข้าถึงสิ้นสุดแล้ว</h1>
        <EmptyNotice>
          การเข้าถึงข้อมูลความคืบหน้าโครงการของคุณสิ้นสุดแล้ว — กรุณาติดต่อผู้อำนวยการโครงการ
        </EmptyNotice>
      </section>
    </PageShell>
  );
}
