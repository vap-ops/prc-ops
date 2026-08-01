import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { telegramDeepLink, TELEGRAM_START_TOKEN_RE } from "@/lib/notifications/telegram-link";
import { NOTIF_TEST_BUTTON, NOTIF_TEST_SENT } from "@/lib/i18n/labels";

// Spec 386 U3 — the deep link is the whole handoff to Telegram. It is built from
// a NEXT_PUBLIC env var the operator types by hand (so a stray "@" is the likely
// mistake) and a token minted by start_telegram_link(). Both halves are pinned
// here because a malformed link fails SILENTLY: Telegram opens, shows a "user not
// found" page, and the user has no way to tell that from "the app is broken".

describe("telegramDeepLink", () => {
  it("builds the t.me start link from a bare username", () => {
    expect(telegramDeepLink("prc_ops_bot", "abc123")).toBe("https://t.me/prc_ops_bot?start=abc123");
  });

  it("tolerates the operator pasting the username WITH its leading @", () => {
    // The Vercel value is typed by hand from BotFather's reply, which shows "@name".
    expect(telegramDeepLink("@prc_ops_bot", "abc123")).toBe(
      "https://t.me/prc_ops_bot?start=abc123",
    );
  });

  it("returns null when the bot username is unset — the caller must render the not-configured copy", () => {
    // U0 may not have landed. A link to https://t.me/undefined?start=… is worse
    // than no button at all, so the builder refuses rather than guessing.
    expect(telegramDeepLink(undefined, "abc123")).toBeNull();
    expect(telegramDeepLink("", "abc123")).toBeNull();
    expect(telegramDeepLink("@", "abc123")).toBeNull();
  });

  it("returns null for a token outside the Bot API's start-payload alphabet", () => {
    // Bot API: start payload is 1..64 of [A-Za-z0-9_-]. Anything else is mangled
    // in transit, so the bot receives a token that can never match a stored row.
    expect(telegramDeepLink("prc_ops_bot", "")).toBeNull();
    expect(telegramDeepLink("prc_ops_bot", "has space")).toBeNull();
    expect(telegramDeepLink("prc_ops_bot", "has/slash")).toBeNull();
    expect(telegramDeepLink("prc_ops_bot", "a".repeat(65))).toBeNull();
  });

  it("accepts the exact shape start_telegram_link() mints — base64url of 32 bytes", () => {
    // rtrim(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=') = 43 chars.
    const minted = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
    expect(minted).toHaveLength(43);
    expect(TELEGRAM_START_TOKEN_RE.test(minted)).toBe(true);
    expect(telegramDeepLink("prc_ops_bot", minted)).toBe(
      `https://t.me/prc_ops_bot?start=${minted}`,
    );
  });
});

// Spec 386 U3 — the defect the §8 handout gate-check exposed. The test button
// read "ส่งข้อความทดสอบเข้า LINE" while sendTestNotification had only a LINE arm,
// so a Telegram-bound OFFICE user — the exact audience this spec exists for, and
// the tier with ZERO OA friends (§1.2) — pressed a button guaranteed to fail.
// Pin the PROPERTY (names no single channel), not the exact string, so a future
// reword cannot quietly reintroduce a channel name.
describe("test-push copy is channel-neutral", () => {
  it("neither label names LINE or Telegram", () => {
    expect(NOTIF_TEST_BUTTON).not.toMatch(/LINE|Telegram/i);
    expect(NOTIF_TEST_SENT).not.toMatch(/LINE|Telegram/i);
  });

  it("sendTestNotification really pushes on BOTH channels, not just imports them", () => {
    // A `toContain` on the symbol is satisfied by the import line alone, so count
    // real uses: each pusher appears once in the import and at least once as a
    // call. Guards against the arm being deleted while the import lingers.
    const src = readFileSync("src/app/settings/notifications/actions.ts", "utf8");
    const uses = (n: string) => src.split(n).length - 1;
    expect(uses("pushTelegramMessage")).toBeGreaterThanOrEqual(2);
    expect(uses("pushLineMessage")).toBeGreaterThanOrEqual(2);
    // …and that "no channel bound at all" is its own state rather than being
    // reported as a LINE problem.
    expect(uses("NOTIF_TEST_NO_CHANNEL_ERROR")).toBeGreaterThanOrEqual(2);
  });
});
