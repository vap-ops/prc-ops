"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { serverEnv } from "@/lib/env.server";
import { pushLineMessage } from "@/lib/notifications/line-push";
import {
  LOCKED_NOTIFICATION_EVENTS,
  type NotificationEventType,
} from "@/lib/notifications/notification-catalog";
import { NOTIF_TEST_MESSAGE, NOTIF_TEST_NONFRIEND_ERROR } from "@/lib/i18n/labels";

export type NotificationSettingResult = { ok: true } | { ok: false; error: string };

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

  const token = serverEnv.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "ยังไม่ได้ตั้งค่า LINE channel access token" };

  // The caller reads its OWN row — the "users read self" RLS policy exposes
  // line_user_id (auth.uid() = id), so the RLS-scoped client suffices; no
  // service-role bypass needed.
  const { data: user } = await auth.supabase
    .from("users")
    .select("line_user_id")
    .eq("id", auth.user.id)
    .single();
  if (!user?.line_user_id) {
    return { ok: false, error: "บัญชีนี้ยังไม่ได้เชื่อม LINE — เข้าสู่ระบบด้วย LINE ก่อน" };
  }

  const result = await pushLineMessage({
    token,
    to: user.line_user_id,
    text: NOTIF_TEST_MESSAGE,
  });
  // A push to a non-friend of the OA returns LINE 403 — the exact case the
  // readiness card's add-friend CTA fixes, so name it plainly.
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.status === 403
          ? NOTIF_TEST_NONFRIEND_ERROR
          : "ส่งข้อความทดสอบไม่สำเร็จ กรุณาลองใหม่",
    };
  }
  return { ok: true };
}
