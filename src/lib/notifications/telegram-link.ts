// Spec 386 U3 — the app→Telegram handoff.
//
// Deliberately a LEAF module: no imports, no `server-only`, no DB. Both a Server
// Component (the settings page) and a Client Component (the bind control) need
// it, and importing a `server-only` module from the client is a build-time 500
// that no jsdom test can see (the spec-371 U2 lesson).

/**
 * Bot API constraint, verified against the docs: the `/start` payload is 1..64
 * characters of `A-Za-z0-9_-`. `start_telegram_link()` mints base64url of 32
 * random bytes = 43 chars, and the DB CHECK on `telegram_link_tokens.token`
 * enforces the same alphabet — this is the client-side half of that contract.
 */
export const TELEGRAM_START_TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Build the deep link that opens the bot with the binding token attached.
 *
 * Returns `null` — rather than a best-effort URL — when the bot username is
 * unset or the token is malformed. A link to `https://t.me/undefined?start=...`
 * fails SILENTLY: Telegram opens and shows "user not found", which a user cannot
 * distinguish from the app being broken. Callers render the not-configured copy
 * instead of a button that cannot work.
 */
export function telegramDeepLink(botUsername: string | undefined, token: string): string | null {
  // The operator types this into Vercel by hand from BotFather's reply, which
  // displays the handle as "@name" — so a leading @ is the likely paste.
  const handle = (botUsername ?? "").trim().replace(/^@/, "");
  if (!handle) return null;
  if (!TELEGRAM_START_TOKEN_RE.test(token)) return null;
  return `https://t.me/${handle}?start=${token}`;
}
