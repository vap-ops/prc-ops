// Spec 264 G3 / ADR 0072 §8 — the organic-visitor landing. A real destination,
// not a dead wall: primary CTAs to self-register (the open self-serve entry —
// the on-site door only; office is invite-only per spec 342 D3; external
// audiences arrive by invite, ADR 0072 §1), plus a secondary note naming who to
// contact for an office invite, plus a tertiary note for someone INVITED as a
// subcontractor/client to open the link they were sent (no self-select of
// client/subcon here — those relationships are invite-gated, not self-declared).

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/common/avatar-surface";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui/classes";
import { OFFICE_ASK_INVITE_LINE } from "@/lib/i18n/labels";
import { VISITOR_REGISTER_ENTRIES } from "@/lib/register/register-entry";

interface VisitorLandingProps {
  greeting: string;
  lineAvatarUrl: string | null;
  fullName: string | null;
}

export function VisitorLanding({ greeting, lineAvatarUrl, fullName }: VisitorLandingProps) {
  return (
    <PageShell variant="card">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <AvatarSurface lineUrl={lineAvatarUrl} fullName={fullName} size={72} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-ink-secondary text-lg">ยินดีต้อนรับสู่ PRC Ops</p>
        <div className="space-y-3">
          {VISITOR_REGISTER_ENTRIES.map((entry, i) => (
            <Link
              key={entry.path}
              href={entry.path}
              className={`${i === 0 ? BUTTON_PRIMARY : BUTTON_SECONDARY} w-full`}
            >
              {entry.label}
            </Link>
          ))}
          <p className="text-ink-secondary text-sm">{OFFICE_ASK_INVITE_LINE}</p>
          <p className="text-ink-secondary text-sm">
            ได้รับลิงก์เชิญเป็นผู้รับเหมา/ลูกค้า? เปิดลิงก์ที่ได้รับ
          </p>
        </div>
        <div className="flex justify-center pt-2">
          <LogoutButton />
        </div>
      </div>
    </PageShell>
  );
}
