// Spec 318 U4 — /settings/notifications. Every authenticated role reaches it
// (getClaims, not requireRole — like /settings, so unserved roles aren't
// bounced). Two parts: a readiness card (LINE link ✓ / OA-friend status +
// add-friend CTA + a test push) and per-event mute toggles filtered to the
// events the caller's role can actually receive (catalog audience). Absence of a
// preference row = ON; the locked safety event is greyed-ON.

import { redirect } from "next/navigation";
import { BellRing, Check, X } from "lucide-react";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { NotificationPreferencesForm } from "@/components/features/notifications/preferences-form";
import { TestNotificationButton } from "@/components/features/notifications/test-notification-button";
import { createClient } from "@/lib/db/server";
import {
  NOTIFICATION_CATALOG,
  toToggleEntry,
  type NotificationEventType,
} from "@/lib/notifications/notification-catalog";
import { readinessFromUserRow, OA_ADD_FRIEND_URL } from "@/lib/notifications/readiness";
import type { UserRole } from "@/lib/auth/role-home";
import {
  NOTIF_ADD_FRIEND_LABEL,
  NOTIF_LINE_LINKED_ROW,
  NOTIF_OA_FRIEND_ROW,
  NOTIF_OA_NONFRIEND_ROW,
  NOTIF_OA_UNKNOWN_ROW,
  NOTIF_READINESS_CARD_HEADING,
  NOTIF_SETTINGS_INTRO,
  NOTIF_SETTINGS_LABEL,
  NOTIF_TELEGRAM_ROW,
} from "@/lib/i18n/labels";
import { GROUP_CARD } from "@/app/settings/section-card";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: NOTIF_SETTINGS_LABEL };

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) redirect("/login");
  const userId = claimsData.claims.sub;

  const { data: row } = await supabase
    .from("users")
    .select("role, line_user_id, line_oa_friend, line_oa_friend_checked_at, telegram_chat_id")
    .eq("id", userId)
    .maybeSingle();
  if (!row) redirect("/login");

  const role = row.role as UserRole;
  const readiness = readinessFromUserRow(row);

  // Only the events this role can actually receive (catalog audience mirrors the
  // recipient rules) — a site_admin never sees the operator/PR-approval toggles.
  // Map to the serializable shape: the audience FUNCTION cannot cross the RSC
  // boundary into the client form.
  const entries = NOTIFICATION_CATALOG.filter((e) => e.audience(role)).map(toToggleEntry);

  // The caller's explicit mutes (own-rows RLS). absence = ON.
  const { data: prefRows } = await supabase
    .from("notification_preferences")
    .select("event_type, enabled")
    .eq("enabled", false);
  const mutedEvents = (prefRows ?? []).map((r) => r.event_type as NotificationEventType);

  const friendKnown = readiness.friendFlag !== null;
  const isFriend = readiness.friendFlag === true;

  return (
    <PageShell>
      <BottomTabBar role={role} />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <div className="flex items-center gap-3">
          <BellRing aria-hidden className="text-ink h-6 w-6 shrink-0" />
          <h1 className="text-title text-ink font-bold tracking-tight">{NOTIF_SETTINGS_LABEL}</h1>
        </div>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* Readiness card */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">
            {NOTIF_READINESS_CARD_HEADING}
          </h2>
          <div className={`${GROUP_CARD} flex flex-col gap-3 border px-4 py-3`}>
            <ReadyRow ok={readiness.lineLinked} label={NOTIF_LINE_LINKED_ROW} />
            {isFriend ? (
              <ReadyRow ok label={NOTIF_OA_FRIEND_ROW} />
            ) : friendKnown ? (
              <div className="flex items-center justify-between gap-3">
                <ReadyRow ok={false} label={NOTIF_OA_NONFRIEND_ROW} />
                <a
                  href={OA_ADD_FRIEND_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${NOTIF_ADD_FRIEND_LABEL} — เปิดแอป LINE`}
                  className="bg-fill text-on-fill text-meta min-h-11 shrink-0 self-center rounded-lg px-4 py-2 font-semibold"
                >
                  {NOTIF_ADD_FRIEND_LABEL}
                </a>
              </div>
            ) : (
              <p className="text-ink-secondary text-meta">{NOTIF_OA_UNKNOWN_ROW}</p>
            )}
            {readiness.telegramLinked ? <ReadyRow ok label={NOTIF_TELEGRAM_ROW} /> : null}
            <TestNotificationButton />
          </div>
        </div>

        <p className="text-ink-secondary text-meta">{NOTIF_SETTINGS_INTRO}</p>

        <NotificationPreferencesForm entries={entries} mutedEvents={mutedEvents} />
      </section>
    </PageShell>
  );
}

function ReadyRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <Check aria-hidden className="text-done-strong h-5 w-5 shrink-0" />
      ) : (
        <X aria-hidden className="text-attn-ink h-5 w-5 shrink-0" />
      )}
      <span className="text-ink text-body">{label}</span>
    </div>
  );
}
