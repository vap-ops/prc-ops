// Telegram Bot API sendMessage wrapper — the notification system's SECOND delivery
// channel, alongside LINE (line-push.ts), for ANY recipient holding a telegram_chat_id.
// One chat per call so a blocked/unknown chat fails individually (counted, never fatal
// to the drain run).
//
// ⚠️ This comment used to say "for super-admins". That was never what the code did —
// the drain's Telegram pass maps the full post-mute recipient set through
// telegramChatByUser with no role filter (drain/route.ts) — and it became actively
// misleading with spec 386, whose whole point is binding the OFFICE tier. Corrected
// rather than left, per the stale-comment class.

// Telegram rejects messages over 4096 chars with HTTP 400 — deterministic, so an
// oversized (user-authored) body would burn every retry. Truncate instead.
const TELEGRAM_TEXT_MAX = 4096;

export type TelegramPushResult = { ok: true } | { ok: false; status: number; body: string };

export async function pushTelegramMessage(args: {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<TelegramPushResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${args.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: args.chatId,
        text: args.text.slice(0, TELEGRAM_TEXT_MAX),
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, body: await response.text() };
  }
  return { ok: true };
}
