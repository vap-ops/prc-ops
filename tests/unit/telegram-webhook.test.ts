import { describe, it, expect } from "vitest";

import {
  parseStartToken,
  replyForConsumeResult,
  type ConsumeResult,
} from "@/lib/notifications/telegram-webhook";
import {
  TG_BOT_ALREADY_LINKED,
  TG_BOT_EXPIRED,
  TG_BOT_LINKED,
  TG_BOT_LINKED_NO_NAME,
  TG_BOT_PROMPT,
} from "@/lib/i18n/labels";

// Spec 386 U2 — the webhook's two pure halves, extracted so they are testable
// without Next's request plumbing. Identity comes ONLY from the token parsed
// here; nothing in the update body is trusted for authorisation (§3.3 step 5).
describe("parseStartToken", () => {
  it("extracts the token from a plain /start", () => {
    expect(parseStartToken("/start abc-123_XYZ")).toBe("abc-123_XYZ");
  });

  it("extracts it from the /start@botname form Telegram sends in some clients", () => {
    expect(parseStartToken("/start@prc_ops_bot abc123")).toBe("abc123");
  });

  it("tolerates surrounding whitespace and newlines", () => {
    expect(parseStartToken("  /start   abc123 \n")).toBe("abc123");
  });

  it("returns null for /start with no payload — the user opened the bot directly", () => {
    expect(parseStartToken("/start")).toBeNull();
    expect(parseStartToken("/start   ")).toBeNull();
  });

  it("returns null for ordinary chatter, so the bot never treats it as a bind", () => {
    expect(parseStartToken("hello")).toBeNull();
    expect(parseStartToken("")).toBeNull();
    expect(parseStartToken(undefined)).toBeNull();
    expect(parseStartToken("/help abc123")).toBeNull();
  });

  it("rejects a payload outside the Bot API alphabet rather than passing it to the RPC", () => {
    expect(parseStartToken("/start has space")).toBe("has");
    expect(parseStartToken("/start bad/slash")).toBeNull();
    expect(parseStartToken(`/start ${"a".repeat(65)}`)).toBeNull();
  });
});

describe("replyForConsumeResult", () => {
  it("names the account back on success — the proof the user bound the RIGHT one", () => {
    const reply = replyForConsumeResult({ ok: true, display_name: "สมชาย ใจดี" });
    expect(reply).toContain("สมชาย ใจดี");
    expect(reply).toBe(TG_BOT_LINKED.replace("{name}", "สมชาย ใจดี"));
  });

  it("falls back to a name-free success when display_name is NULL", () => {
    // Live: display_name = coalesce(full_name, line_display_name), and BOTH can
    // be null. Interpolating that would print "— null", which reads as a bug in
    // the exact message whose job is to be trustworthy.
    const reply = replyForConsumeResult({ ok: true, display_name: null });
    expect(reply).toBe(TG_BOT_LINKED_NO_NAME);
    expect(reply).not.toMatch(/null|undefined|\{name\}/);
  });

  it("tells an expired link how to retry — it IS retryable", () => {
    expect(replyForConsumeResult({ ok: false, reason: "invalid_or_expired" })).toBe(TG_BOT_EXPIRED);
  });

  it("never offers a retry for chat_already_linked — it is PERMANENT", () => {
    // The honest-copy class: this refusal cannot succeed however many times the
    // user taps, so the copy must not say ลองใหม่/อีกครั้ง.
    const reply = replyForConsumeResult({ ok: false, reason: "chat_already_linked" });
    expect(reply).toBe(TG_BOT_ALREADY_LINKED);
    expect(reply).not.toMatch(/ลองใหม่|อีกครั้ง/);
  });

  it("falls back to the prompt for an unrecognised reason instead of throwing", () => {
    const odd = { ok: false, reason: "something_new" } as unknown as ConsumeResult;
    expect(replyForConsumeResult(odd)).toBe(TG_BOT_PROMPT);
  });
});
