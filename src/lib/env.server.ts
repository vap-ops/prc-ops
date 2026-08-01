// Server-only environment validation.
//
// The `import "server-only"` directive causes a build error if any client
// component (or any module that ends up in the client bundle) imports this
// file. Use this for secrets that must never reach the browser.
//
// Server code that also needs NEXT_PUBLIC_* values should import `clientEnv`
// from `./env`. Do not duplicate client vars into this module.

import "server-only";
import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // LINE Login (server-side only). The app runs LINE's OAuth and HS256
  // id_token verification itself per ADR 0012. Channel secret is the HMAC
  // key for verification; channel id is the audience claim.
  LINE_CHANNEL_ID: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().min(1),
  // LINE Messaging API (spec 32 / ADR 0037). Both OPTIONAL on purpose:
  // the notification drain endpoint answers 503 until the operator
  // configures the Messaging channel — deploys must keep booting without
  // these. Distinct channel from LINE Login above. Empty string counts
  // as absent: a copied .env.example line or a blank Vercel value must
  // not crash boot.
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: optionalNonEmpty,
  NOTIFICATION_DRAIN_SECRET: optionalNonEmpty,
  // Telegram Bot token — the notification drain's SECOND delivery channel, for
  // ANY recipient holding a telegram_chat_id (the drain applies no role filter;
  // the old "super-admins" wording here was stale, and spec 386 binds the OFFICE
  // tier precisely because LINE cannot reach it). OPTIONAL like the LINE token:
  // the drain simply skips Telegram pushes when it's absent.
  TELEGRAM_BOT_TOKEN: optionalNonEmpty,
  // Spec 386 U2 — the shared secret Telegram stamps on every webhook delivery as
  // X-Telegram-Bot-Api-Secret-Token (set once via setWebhook). It is the
  // webhook's ONLY authentication: nothing in the update body is trustworthy,
  // since anyone can POST JSON claiming any chat id. OPTIONAL like the tokens
  // above, and the route answers 503 (never 200) while it is unset, so a deploy
  // that is missing it rejects rather than accepts.
  TELEGRAM_WEBHOOK_SECRET: optionalNonEmpty,
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment variables:\n${issues}`);
  }
  return result.data;
}

export const serverEnv = parseServerEnv(process.env);
