// Spec 376 U4 (§3.3, D5) — the shared-phone register interstitial.
//
// A new ช่าง scans the site's register QR on a phone that still carries SOMEONE
// ELSE's live session. Before this screen both outcomes were silent: a
// `technician` session was redirected into that person's home, and every other
// signed-in role dropped into the fresh registration form UNDER their identity —
// "no form and no explanation" (the live spec-328 pilot risk on the owed list).
//
// So: name whose session this is, and offer exactly ONE way forward — log out
// and come straight back to THIS door with the QR's attribution params intact.
// `returnTo` is that path (built by registerReturnPath); LogoutButton hands it to
// /auth/logout?next, which re-validates it with safeNextPath.
//
// Server Component (no 'use client'): static copy plus LogoutButton's plain
// <form method="post">, so the escape hatch works with zero JS on the device —
// which matters, because a borrowed phone is exactly where a stale bundle lives.

import { LogoutButton } from "@/components/auth/logout-button";
import { PageShell } from "@/components/features/chrome/page-shell";
import { CARD_LAYOUT, SECTION_HEADING } from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

const HEADING = "เครื่องนี้มีคนอื่นเข้าสู่ระบบอยู่";

/** The one action. Interpolated into the hint below so the prose can never name
 * a button label that has drifted. */
const LOGOUT_TO_REGISTER_LABEL = "ออกจากระบบเพื่อสมัครใหม่";

const HINT = `หากนี่ไม่ใช่บัญชีของท่าน กดปุ่ม “${LOGOUT_TO_REGISTER_LABEL}” ด้านล่าง แล้วสมัครด้วยบัญชีของท่านเอง`;

export interface ForeignSessionNoticeProps {
  /** Whose session this is — always non-empty (the reader must recognise, or
   * rule out, the account they are standing in). */
  displayName: string;
  /** This register door WITH its QR params — where logout must land. */
  returnTo: string;
}

export function ForeignSessionNotice({ displayName, returnTo }: ForeignSessionNoticeProps) {
  return (
    <PageShell>
      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>{HEADING}</h1>
        <div className={`${CARD_LAYOUT} border-attn-edge bg-attn-soft`}>
          <p className="text-attn-ink text-sm font-semibold">
            เข้าสู่ระบบในชื่อ {displayName} อยู่
          </p>
          <p className="text-attn-ink mt-1 text-sm">{HINT}</p>
        </div>
        <LogoutButton label={LOGOUT_TO_REGISTER_LABEL} next={returnTo} />
      </section>
    </PageShell>
  );
}
