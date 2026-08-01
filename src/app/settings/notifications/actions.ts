"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { clientEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { pushLineMessage } from "@/lib/notifications/line-push";
import { pushTelegramMessage } from "@/lib/notifications/telegram-push";
import { telegramDeepLink } from "@/lib/notifications/telegram-link";
import {
  LOCKED_NOTIFICATION_EVENTS,
  type NotificationEventType,
} from "@/lib/notifications/notification-catalog";
import {
  NOTIF_TEST_MESSAGE,
  NOTIF_TEST_NO_CHANNEL_ERROR,
  NOTIF_TEST_NONFRIEND_ERROR,
  NOTIF_TEST_QUOTA_ERROR,
  NOTIF_TELEGRAM_BIND_ERROR,
  NOTIF_TELEGRAM_NOT_CONFIGURED,
  NOTIF_TELEGRAM_UNLINK_ERROR,
} from "@/lib/i18n/labels";

export type NotificationSettingResult = { ok: true } | { ok: false; error: string };
export type TelegramLinkResult = { ok: true; url: string } | { ok: false; error: string };

// Spec 318 U4 — set the caller's own mute for one event. absence = ON, so an
// enabled=true row is stored explicitly too (a re-enable after a mute). The
// user-session client calls the DEFINER RPC (self-scoped via auth.uid(); it
// re-gates + refuses the locked safety event). The early locked check here is
// the friendly guard so a locked toggle can't even be attempted.
export async function saveNotificationPreference(
  event: NotificationEventType,
  enabled: boolean,
): Promise<NotificationSettingResult> {
  if (LOCKED_NOTIFICATION_EVENTS.includes(event)) {
    return { ok: false, error: "การแจ้งเตือนนี้ปิดไม่ได้" };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("set_notification_preference", {
    p_event: event,
    p_enabled: enabled,
  });
  if (error) return { ok: false, error: "บันทึกการตั้งค่าไม่สำเร็จ" };

  revalidatePath("/settings/notifications");
  return { ok: true };
}

// Spec 318 U4 — send a plain test push to the caller's OWN LINE so they can
// confirm notifications reach them (the spec-212 sample-push precedent, text not
// Flex). Reads the caller's own line_user_id via the admin client (not
// self-readable under RLS); every honest failure gets its own Thai message.
export async function sendTestNotification(): Promise<NotificationSettingResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // The caller reads its OWN row — the "users read self" RLS policy exposes
  // line_user_id and telegram_chat_id (auth.uid() = id), so the RLS-scoped
  // client suffices; no service-role bypass needed.
  const { data: user } = await auth.supabase
    .from("users")
    .select("line_user_id, telegram_chat_id")
    .eq("id", auth.user.id)
    .single();

  const lineToken = serverEnv.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  const telegramToken = serverEnv.TELEGRAM_BOT_TOKEN;
  const lineTarget = lineToken ? (user?.line_user_id ?? null) : null;
  const telegramTarget = telegramToken ? (user?.telegram_chat_id ?? null) : null;

  // Spec 386 U3 — this used to be LINE-only, and its button said "…เข้า LINE".
  // For the office tier that is the one channel that provably cannot reach them
  // (§1.2: zero OA friends among the deciding roles), so a Telegram-bound user
  // pressing "test" was guaranteed a failure. Mirror the DRAIN's semantics
  // instead: push to every channel the caller has bound, and succeed if ANY
  // lands (`anySuccess`, drain/route.ts).
  if (!lineTarget && !telegramTarget) {
    return { ok: false, error: NOTIF_TEST_NO_CHANNEL_ERROR };
  }

  let anySuccess = false;
  let lineStatus: number | null = null;

  if (telegramTarget && telegramToken) {
    const result = await pushTelegramMessage({
      token: telegramToken,
      chatId: telegramTarget,
      text: NOTIF_TEST_MESSAGE,
    });
    if (result.ok) anySuccess = true;
  }

  if (lineTarget && lineToken) {
    const result = await pushLineMessage({
      token: lineToken,
      to: lineTarget,
      text: NOTIF_TEST_MESSAGE,
    });
    if (result.ok) anySuccess = true;
    else lineStatus = result.status;
  }

  if (anySuccess) return { ok: true };

  // Nothing landed. Keep LINE's two honest, non-retryable classifications — a
  // 403 is "not an OA friend" (the add-friend CTA fixes it) and a 429 is the
  // MONTHLY quota, which cannot succeed on a retry until the billing cycle rolls
  // (spec 387 U1, the honest-copy class). Both only apply when LINE was the
  // channel that refused.
  return {
    ok: false,
    error:
      lineStatus === 403
        ? NOTIF_TEST_NONFRIEND_ERROR
        : lineStatus === 429
          ? NOTIF_TEST_QUOTA_ERROR
          : "ส่งข้อความทดสอบไม่สำเร็จ กรุณาลองใหม่",
  };
}

// Spec 386 U3 — mint a one-time binding token for the caller and hand back the
// t.me deep link. `start_telegram_link()` is SECURITY DEFINER and self-scoped on
// auth.uid() (verified live: EXECUTE granted to authenticated, revoked from
// anon), because `authenticated` holds no UPDATE grant on `users` at all (§1.3).
// Minting ROTATES: the RPC deletes the caller's unconsumed tokens first, so an
// abandoned link dies the moment a new one is requested.
export async function startTelegramLink(): Promise<TelegramLinkResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const botUsername = clientEnv.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!botUsername) return { ok: false, error: NOTIF_TELEGRAM_NOT_CONFIGURED };

  const { data, error } = await auth.supabase.rpc("start_telegram_link");
  if (error || typeof data !== "string") {
    return { ok: false, error: NOTIF_TELEGRAM_BIND_ERROR };
  }

  // Refuse rather than hand back a malformed link: t.me/<bad> opens Telegram on
  // a "user not found" page, which the user cannot tell from a broken app.
  const url = telegramDeepLink(botUsername, data);
  if (!url) return { ok: false, error: NOTIF_TELEGRAM_BIND_ERROR };

  return { ok: true, url };
}

// Spec 386 U3 — one tap, no confirmation dialog: it is reversible in two taps.
// Clears telegram_chat_id + telegram_linked_at and drops unconsumed tokens.
export async function unlinkTelegram(): Promise<NotificationSettingResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("unlink_telegram");
  if (error) return { ok: false, error: NOTIF_TELEGRAM_UNLINK_ERROR };

  revalidatePath("/settings/notifications");
  return { ok: true };
}
