// Spec 32 — LINE Messaging API push wrapper. One recipient per call so a
// non-friend recipient fails individually (counted, never fatal to the
// drain run).

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

// LINE rejects text messages over 5000 chars with HTTP 400 — deterministic,
// so an oversized (user-authored) comment would burn all retry attempts and
// suppress the notification entirely. Truncate instead.
const LINE_TEXT_MAX = 5000;

// LINE caps a Flex message's altText (the notification-list / fallback string)
// at 400 chars and 400s an oversize one — truncate like the text path.
const LINE_ALT_MAX = 400;

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

// Spec 212 — push a LINE Flex Message (a rich bubble) to one recipient. Same
// contract as pushLineMessage; `contents` is the Flex container JSON (the daily
// report bubble), `altText` the notification-list fallback (capped at 400).
export async function pushLineFlex(args: {
  token: string;
  to: string;
  altText: string;
  contents: unknown;
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
        messages: [
          { type: "flex", altText: args.altText.slice(0, LINE_ALT_MAX), contents: args.contents },
        ],
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
