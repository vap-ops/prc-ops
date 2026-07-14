// Spec 316 U3 — สิทธิ์การใช้งาน: the derived who-can-do-what read surface.
// Renders the CapabilityExplorer island over the spec-316 registry (whose
// membership IS the live role-set constants), so this page can never disagree
// with the real gates. super_admin-only like /settings/roles; fully static —
// no DB read at all. Back chip → /settings/roles (the screen it explains).

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { CapabilityExplorer } from "@/components/features/roles/capability-explorer";
import { requireRole } from "@/lib/auth/require-role";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: "สิทธิ์การใช้งาน" };

export default async function RoleCapabilitiesPage() {
  await requireRole(["super_admin"]);

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings/roles" backLabel="กลับไปจัดการสิทธิ์">
        <h1 className="text-ink text-lg font-semibold">สิทธิ์การใช้งาน</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          บทบาทแต่ละแบบเห็นและทำอะไรได้บ้าง — สร้างจากกฎสิทธิ์จริงของระบบ
        </p>
        <CapabilityExplorer />
      </section>
    </PageShell>
  );
}
