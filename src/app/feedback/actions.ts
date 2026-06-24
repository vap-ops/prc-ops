"use server";

// Spec 193 — submit in-app feedback. The action captures the two context signals
// the client shouldn't be trusted to set: the app VERSION (the deployed
// package.json — which code state) and the USER-AGENT (mobile-vs-desktop). The
// submit_feedback definer stamps submitted_by + role_snapshot. RLS-scoped session.

import "server-only";

import { headers } from "next/headers";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { validateFeedback, isFeedbackType } from "@/lib/feedback/validate";
import type { Database } from "@/lib/db/database.types";
import pkg from "../../../package.json";

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

const GENERIC = "ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function submitFeedback(input: {
  type: string;
  title: string;
  body: string;
  screen: string;
  pagePath: string;
}): Promise<SubmitFeedbackResult> {
  const validation = validateFeedback(input);
  if (validation) return { ok: false, error: validation };
  if (!isFeedbackType(input.type)) return { ok: false, error: GENERIC };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // Optional args are OMITTED when empty (exactOptionalPropertyTypes) — the SQL
  // defaults to null. app_version + user_agent are the server-captured context.
  const rpcArgs: Database["public"]["Functions"]["submit_feedback"]["Args"] = {
    p_type: input.type,
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_app_version: pkg.version,
  };
  const screen = input.screen.trim();
  if (screen) rpcArgs.p_screen = screen;
  const pagePath = input.pagePath.trim().slice(0, 500);
  if (pagePath) rpcArgs.p_page_path = pagePath;
  const userAgent = (await headers()).get("user-agent");
  if (userAgent) rpcArgs.p_user_agent = userAgent;

  const { error } = await auth.supabase.rpc("submit_feedback", rpcArgs);
  if (error) return { ok: false, error: GENERIC };
  return { ok: true };
}
