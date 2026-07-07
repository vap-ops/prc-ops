// Spec 274 U2 — on identity-scoped pages (/technician, /portal, /client) a
// super_admin viewing-as sees no personal data (the reads self-scope to their own,
// non-existent, worker/contractor/client record). This note makes that emptiness
// read as intentional rather than a bug. Renders null for a real occupant of the
// role (no active view-as), so it's invisible in normal use.

import { getActiveViewAs } from "@/lib/auth/view-as-state.server";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";

export async function ViewAsEmptyNote() {
  const assumed = await getActiveViewAs();
  if (!assumed) return null;

  return (
    <div className={`${CARD} border-attn bg-attn-soft mb-4`}>
      <p className="text-attn-ink text-sm">
        กำลังดูในมุมมอง <span className="font-semibold">{USER_ROLE_LABEL[assumed]}</span> —
        หน้านี้เป็นข้อมูลส่วนตัวของผู้ใช้แต่ละคน จึงว่างเปล่าเมื่อดูในฐานะ super_admin
      </p>
    </div>
  );
}
