"use server";

// Spec 212 — send a SAMPLE daily report to the caller's own LINE, so the operator
// can see the real Flex bubble render before we wire the feature for the team
// ("test with me first"). Targets the LOGGED-IN user's line_user_id — never a
// guessed recipient (there are ≥2 LINE-linked super_admins). super_admin only.

import { requireActionRole, NOT_PERMITTED } from "@/lib/auth/action-gate";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { serverEnv } from "@/lib/env.server";
import { pushLineFlex } from "@/lib/notifications/line-push";
import { dailyReportFlexMessage } from "@/lib/daily-report/flex";
import { SAMPLE_DAILY_REPORT } from "@/lib/daily-report/sample";

export type DailyReportPreviewResult = { ok: true } | { ok: false; error: string };

export async function sendDailyReportPreviewToSelf(): Promise<DailyReportPreviewResult> {
  const gate = await requireActionRole(["super_admin"], NOT_PERMITTED);
  if ("error" in gate) return { ok: false, error: gate.error };

  const token = serverEnv.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "ยังไม่ได้ตั้งค่า LINE channel access token" };

  // Read the caller's own LINE id (admin client — line_user_id is not self-readable
  // under RLS in app code paths; we only ever use the caller's own id here).
  const admin = createAdminClient();
  const { data: user } = await admin
    .from("users")
    .select("line_user_id")
    .eq("id", gate.auth.user.id)
    .single();

  if (!user?.line_user_id) {
    return { ok: false, error: "บัญชีนี้ยังไม่ได้เชื่อม LINE — เข้าสู่ระบบด้วย LINE ก่อน" };
  }

  const message = dailyReportFlexMessage(SAMPLE_DAILY_REPORT);
  const result = await pushLineFlex({
    token,
    to: user.line_user_id,
    altText: message.altText,
    contents: message.contents,
  });

  if (!result.ok) return { ok: false, error: "ส่งเข้า LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  return { ok: true };
}
