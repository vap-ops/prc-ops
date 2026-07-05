// Spec 265 U2 — the shared, presentational LINE-identity block. Server
// component (no client state): renders the applicant/user's LINE ground-truth
// identity — the ORIGINAL line_avatar_url in a plain <img> (external LINE-CDN
// URL, referrerPolicy="no-referrer" per ADR 0020 — a raw img element, never the
// framework image optimizer, so no remote-pattern config), the LINE display
// name (label "ชื่อ LINE", the
// verification anchor, NEVER confused with the product's full_name), and the
// "ตรวจล่าสุด …" last-checked time. When the person has not logged in since
// spec 265 U1 shipped (line_synced_at NULL) it shows the "ยังไม่ได้ซิงค์"
// empty state instead of empty fields. Reused by BOTH surfaces
// (/registrations/[id] and /settings/roles/[id]) so the anti-impersonation
// view is identical wherever a super_admin (or approver) sees it.

import { getInitials } from "@/lib/profile/resolve-avatar";
import { buildLineIdentityView, type LineIdentityInput } from "@/lib/identity/line-identity";
import { CARD } from "@/lib/ui/classes";
import { LINE_DISPLAY_NAME_LABEL, LINE_IDENTITY_HEADING } from "@/lib/i18n/labels";

const AVATAR_PX = 56;

export function LineIdentityBlock(props: LineIdentityInput) {
  const view = buildLineIdentityView(props);

  return (
    <section className={CARD} aria-label={LINE_IDENTITY_HEADING}>
      <p className="text-ink text-sm font-semibold">{LINE_IDENTITY_HEADING}</p>

      {view.synced ? (
        <div className="mt-3 flex items-center gap-3">
          {view.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={view.avatarUrl}
              alt={LINE_DISPLAY_NAME_LABEL}
              width={AVATAR_PX}
              height={AVATAR_PX}
              referrerPolicy="no-referrer"
              loading="lazy"
              className="max-w-full shrink-0 rounded-full object-cover"
              style={{ width: AVATAR_PX, height: AVATAR_PX }}
            />
          ) : (
            <span
              aria-hidden
              className="bg-sunk text-ink inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
              style={{
                width: AVATAR_PX,
                height: AVATAR_PX,
                fontSize: Math.round(AVATAR_PX * 0.38),
              }}
            >
              {getInitials(view.displayName) || "?"}
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="text-ink-muted text-meta">{LINE_DISPLAY_NAME_LABEL}</span>
            <span className="text-ink text-body font-semibold break-words">
              {view.displayName ?? "—"}
            </span>
            {view.syncedAtLabel ? (
              <span className="text-ink-secondary text-meta mt-0.5">{view.syncedAtLabel}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-ink-secondary mt-2 text-sm">{view.notSyncedLabel}</p>
      )}
    </section>
  );
}
