// Spec 291 U2 (TASK 7) — a presentational digital employee-ID card for
// /profile: identity + STATUSES ONLY. Never a PDPA value (no ID numbers, no
// consent text — the ProfileCard type it renders carries none) and no live
// QR (deferred). Pure render of loadProfileCard's ProfileCard
// (src/lib/profile/load-profile-card.ts) — a Server Component, same idiom as
// the existing e-employee card (src/components/features/register/
// employee-card.tsx), whose badge-tone classes this reuses verbatim.
//
// States, driven off `card.registration` (spec 291 "Never rendered on
// profile" + the operator-approved v1 card design):
// - rejected -> ONLY the contact-admin message, no card body.
// - null (a directly-assigned internal role, e.g. super_admin/PM, has no
//   staff_registrations row) -> the full ISSUED card, just no reg badge.
// - pending/approved -> the full card WITH the registration badge.

import { AvatarSurface } from "@/components/features/common/avatar-surface";
import { registrationStatusBadge, type BadgeTone } from "@/lib/register/card-view";
import { USER_ROLE_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import { BANNER_ERROR } from "@/lib/ui/classes";
import type { ProfileCard } from "@/lib/profile/load-profile-card";

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  pending: "border-attn-edge bg-attn-soft text-attn-ink",
  approved: "border-done-edge bg-done-soft text-done-ink",
  rejected: "border-danger-edge bg-danger-soft text-danger-ink",
};

export function EmployeeIdCard({ card }: { card: ProfileCard }) {
  if (card.registration?.status === "rejected") {
    return <div className={BANNER_ERROR}>การลงทะเบียนไม่ผ่าน โปรดติดต่อผู้ดูแล</div>;
  }

  const roleLabel = USER_ROLE_LABEL[card.role];
  const badge = card.registration ? registrationStatusBadge(card.registration.status) : null;

  return (
    <div className="rounded-card border-edge bg-card overflow-hidden border">
      <div className="bg-brand text-on-brand flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-control bg-attn text-on-attn flex h-8 w-8 shrink-0 items-center justify-center text-sm font-extrabold">
            P
          </span>
          <div className="leading-tight">
            <p className="text-body font-bold">PRC</p>
            <p className="text-meta opacity-80">บัตรพนักงานดิจิทัล</p>
          </div>
        </div>
        <span className="bg-attn-soft text-attn-ink text-meta shrink-0 rounded-full px-2.5 py-1 font-semibold">
          {roleLabel}
        </span>
      </div>
      <div className="bg-attn h-1" />
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-3">
          <AvatarSurface lineUrl={card.avatarUrl} fullName={card.fullName} size={56} />
          <div className="min-w-0">
            <p className="text-body text-ink truncate font-semibold">
              {card.fullName || "ยังไม่ระบุชื่อ"}
            </p>
            <p className="text-meta text-ink-secondary">{roleLabel}</p>
            <p className="text-meta text-ink-muted">{card.departmentName || "ยังไม่ระบุแผนก"}</p>
          </div>
        </div>

        {card.employeeId ? (
          <p className="bg-sunk text-ink-secondary text-meta w-fit rounded-full px-3 py-1 font-mono">
            รหัส {card.employeeId}
          </p>
        ) : null}

        {badge || card.pdpaConsent ? (
          <div className="flex flex-wrap items-center gap-2">
            {badge ? (
              <span
                className={`text-meta inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${BADGE_TONE_CLASSES[badge.tone]}`}
              >
                {badge.label}
              </span>
            ) : null}
            {card.pdpaConsent ? (
              <span className="text-meta text-ink-muted">
                ยินยอม PDPA ·{" "}
                {card.pdpaConsent.status === "given"
                  ? `ให้แล้ว ${formatThaiDate(card.pdpaConsent.at)}`
                  : "เพิกถอนแล้ว"}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
