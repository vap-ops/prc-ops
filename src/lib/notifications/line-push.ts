// Spec 32 — LINE Messaging API push wrapper. One recipient per call so a
// non-friend recipient fails individually (counted, never fatal to the
// drain run).

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

// LINE rejects text messages over 5000 chars with HTTP 400 — deterministic,
// so an oversized (user-authored) comment would burn all retry attempts and
// suppress the notification entirely. Truncate instead.
const LINE_TEXT_MAX = 5000;

export type LinePushResult = { ok: true } | { ok: false; status: number; body: string };

export async function pushLineMessage(args: {
  token: string;
  to: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<LinePushResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: args.to,
        messages: [{ type: "text", text: args.text.slice(0, LINE_TEXT_MAX) }],
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
