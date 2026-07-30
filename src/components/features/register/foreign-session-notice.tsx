// Spec 376 U4 (§3.3, D5) — the shared-phone register interstitial.
//
// A new ช่าง scans the site's register QR on a phone that still carries SOMEONE
// ELSE's live session. Before this screen both outcomes were silent: a
// `technician` session was redirected into that person's home, and every other
// signed-in role dropped into the fresh registration form UNDER their identity —
// "no form and no explanation" (the live spec-328 pilot risk on the owed list).
//
// So: name whose session this is, and offer two ways out.
//
// PRIMARY — log out and come straight back to THIS door with the QR's
// attribution params intact. `returnTo` is that path (built by
// registerReturnPath); LogoutButton hands it to /auth/logout?next, which
// re-validates it with safeNextPath.
//
// SECONDARY — `homeHref` (roleHome of the signed-in account). Needed because
// "borrowed" is the conservative reading of an ambiguous session, not a proven
// one: `technician` is foreign by ROLE, so every ช่าง who re-scans the site
// poster on their OWN phone lands here, as does the site admin who printed it.
// For them logout is a closed loop (back to this door; signing in again with the
// same LINE identity lands here again) and this page carries no bottom bar and
// no hub strip, so the link is the only in-app break in it. Which is also why
// the heading may not assert that the session belongs to someone ELSE — the
// hint below does the disambiguating, conditionally and truthfully.
//
// Server Component (no 'use client'): static copy plus LogoutButton's plain
// <form method="post">, so the escape hatch works with zero JS on the device —
// which matters, because a borrowed phone is exactly where a stale bundle lives.

import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { PageShell } from "@/components/features/chrome/page-shell";
import { CARD_LAYOUT, SECTION_HEADING } from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

/** Neutral on purpose: true whether the session's owner is the person holding
 * the phone or not, because this screen cannot tell (see the header). */
const HEADING = "เครื่องนี้มีการเข้าสู่ระบบอยู่แล้ว";

/** The primary action. Interpolated into the hint below so the prose can never
 * name a button label that has drifted. */
const LOGOUT_TO_REGISTER_LABEL = "ออกจากระบบเพื่อสมัครใหม่";

const HINT = `หากนี่ไม่ใช่บัญชีของท่าน กดปุ่ม “${LOGOUT_TO_REGISTER_LABEL}” ด้านล่าง แล้วสมัครด้วยบัญชีของท่านเอง`;

/** Same term and same idiom as the register folder's other way-out link
 * (docs-owed-card). */
const HOME_LABEL = "ไปหน้าหลัก";

export interface ForeignSessionNoticeProps {
  /** Whose session this is — always non-empty (the reader must recognise, or
   * rule out, the account they are standing in). */
  displayName: string;
  /** This register door WITH its QR params — where logout must land. */
  returnTo: string;
  /** roleHome() of the signed-in account, resolved by borrowedRegisterSession
   * from the role it already read. The secondary exit. */
  homeHref: string;
}

export function ForeignSessionNotice({
  displayName,
  returnTo,
  homeHref,
}: ForeignSessionNoticeProps) {
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
        {/* Visually secondary to the bordered logout button — no border, no fill
            — but a full-height tap target, because a gloved hand on a shared
            phone is the audience. */}
        <Link
          href={homeHref}
          className="text-action focus-visible:ring-action inline-flex min-h-11 items-center gap-1 self-start rounded-md px-1 text-sm font-medium focus:outline-none focus-visible:ring-2"
        >
          {HOME_LABEL}
        </Link>
      </section>
    </PageShell>
  );
}
