// Spec 192 U3 — the "you're not on this team" state. Shown (in place of a bare
// 404) when a project exists but the caller can't see it (not a member and not the
// lead, can_see_project / ADR 0056). The page wraps this in the standard chrome
// (PageShell + BottomTabBar + a DetailHeader back to /projects); this is just the
// explanatory card so it's testable on its own.

import { PAGE_MAX_W } from "@/lib/ui/page-width";

export function NoAccessNotice() {
  return (
    <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
      <div className="rounded-card border-edge bg-card shadow-card border p-5">
        <p className="text-ink text-base font-semibold">คุณยังไม่ได้อยู่ในทีมของโครงการนี้</p>
        <p className="text-ink-secondary mt-2 text-sm">
          ติดต่อผู้จัดการโครงการเพื่อขอเพิ่มคุณเข้าทีม จึงจะเห็นและทำงานในโครงการนี้ได้
        </p>
      </div>
    </section>
  );
}
