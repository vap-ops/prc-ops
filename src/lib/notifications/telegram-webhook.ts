// Spec 386 U2 — the webhook's pure halves, kept out of the route so they are
// testable without Next's request plumbing (the "untestable exemption is bigger
// than the untestable part" lesson: the HTTP shell is what jsdom cannot model,
// the parsing and copy decisions are ordinary functions).

import {
  TG_BOT_ALREADY_LINKED,
  TG_BOT_EXPIRED,
  TG_BOT_LINKED,
  TG_BOT_LINKED_NO_NAME,
  TG_BOT_PROMPT,
} from "@/lib/i18n/labels";
import { TELEGRAM_START_TOKEN_RE } from "@/lib/notifications/telegram-link";

/** The live shape of consume_telegram_link_token's jsonb return. */
export type ConsumeResult =
  | { ok: true; display_name: string | null }
  | { ok: false; reason: "invalid_or_expired" | "chat_already_linked" };

/**
 * Pull the binding token out of a `/start <token>` message.
 *
 * Returns null for everything else — no payload, ordinary chatter, another
 * command, or a payload outside the Bot API alphabet. A null here is NOT an
 * error: the route answers with the prompt copy and a 200, because a 4xx makes
 * Telegram retry and eventually disable the webhook (§3.3 step 3).
 */
export function parseStartToken(text: string | undefined | null): string | null {
  if (!text) return null;
  // Telegram sends `/start@botname payload` in some clients; both forms count.
  const match = text.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?/);
  if (!match) return null;
  const payload = match[1];
  if (!payload) return null;
  // Validate before it reaches the RPC: a malformed payload can never match a
  // stored row, so refusing here keeps the DB call meaningful.
  return TELEGRAM_START_TOKEN_RE.test(payload) ? payload : null;
}

/**
 * The bot's in-chat reply, matched HONESTLY to the outcome.
 *
 * Success names the account back — on a shared phone that is the user's only
 * signal they bound their own identity rather than whoever was signed into
 * Telegram (§8 D4). `chat_already_linked` is permanent and deliberately offers
 * no retry.
 */
export function replyForConsumeResult(result: ConsumeResult): string {
  if (result.ok) {
    const name = result.display_name?.trim();
    return name ? TG_BOT_LINKED.replace("{name}", name) : TG_BOT_LINKED_NO_NAME;
  }
  if (result.reason === "invalid_or_expired") return TG_BOT_EXPIRED;
  if (result.reason === "chat_already_linked") return TG_BOT_ALREADY_LINKED;
  // A reason this build does not know about (an RPC newer than this deploy).
  // Say the neutral thing rather than throw — throwing would 500, and Telegram
  // retries a 500.
  return TG_BOT_PROMPT;
}
