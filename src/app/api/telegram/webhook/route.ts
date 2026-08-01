// Spec 386 U2 — the Telegram bind webhook.
//
// Telegram never hands an application a chat id; it hands one to a BOT, and only
// once the user has messaged that bot. So this endpoint is the return leg of the
// binding round trip: the app mints a one-time token (U3 → start_telegram_link),
// the user taps START in Telegram, and Telegram POSTs the update here with the
// chat id attached.
//
// SECURITY, and it is the whole design:
//   * The X-Telegram-Bot-Api-Secret-Token header is the ONLY authentication.
//     Nothing in the body is trustworthy — anyone can POST JSON claiming any
//     chat.id, from.id or username.
//   * Identity comes from the TOKEN alone. The payload's from.id / chat.username
//     are never read for authorisation, only chat.id as the delivery address.
//   * consume_telegram_link_token is granted to service_role ONLY (verified
//     live: `authenticated` is refused 42501), so the admin client is required
//     here and this route is the single legitimate caller.

import { NextResponse, type NextRequest } from "next/server";

import { createClient as createAdminClient } from "@/lib/db/admin";
import { serverEnv } from "@/lib/env.server";
import { secretMatches } from "@/lib/notifications/secret-compare";
import { pushTelegramMessage } from "@/lib/notifications/telegram-push";
import {
  parseStartToken,
  replyForConsumeResult,
  type ConsumeResult,
} from "@/lib/notifications/telegram-webhook";
import { TG_BOT_PROMPT } from "@/lib/i18n/labels";

// Never prerender or cache an authenticated webhook.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const botToken = serverEnv.TELEGRAM_BOT_TOKEN;
  const secret = serverEnv.TELEGRAM_WEBHOOK_SECRET;

  // Mirror the drain's not_configured posture: a deploy missing the secret must
  // REJECT rather than accept. Answering 200 here would let an unauthenticated
  // caller through the moment the env var went missing.
  if (!botToken || !secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // From here on the caller is authenticated as Telegram, so every remaining
  // answer is 200 — a 4xx makes Telegram retry and eventually DISABLE the
  // webhook, which would break binding for everyone, silently.
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = (update as { message?: { text?: string; chat?: { id?: number | string } } })
    ?.message;
  const chatId = message?.chat?.id;
  if (chatId === undefined || chatId === null) {
    // An update kind we do not handle (edited message, channel post, …).
    return NextResponse.json({ ok: true });
  }
  const chat = String(chatId);

  const token = parseStartToken(message?.text);
  if (!token) {
    await pushTelegramMessage({ token: botToken, chatId: chat, text: TG_BOT_PROMPT });
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_telegram_link_token", {
    p_token: token,
    p_chat_id: chat,
  });

  if (error) {
    // Do not guess at the cause in the user's chat. Say the neutral thing and
    // let the app-side flow be retried; the 200 keeps the webhook healthy.
    await pushTelegramMessage({ token: botToken, chatId: chat, text: TG_BOT_PROMPT });
    return NextResponse.json({ ok: true });
  }

  await pushTelegramMessage({
    token: botToken,
    chatId: chat,
    text: replyForConsumeResult(data as unknown as ConsumeResult),
  });
  return NextResponse.json({ ok: true });
}
