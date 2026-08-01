import { describe, it, expect, vi, beforeEach } from "vitest";

// Spec 386 U2 — the ROUTE's security posture. The pure halves are covered in
// telegram-webhook.test.ts; what is pinned here is the behaviour that, if it
// regressed, would either let an unauthenticated caller write an identity link
// or get the webhook disabled by Telegram.

type PushArgs = { token: string; chatId: string; text: string };

const rpc = vi.fn();
const push = vi.fn(async (_args: PushArgs) => ({ ok: true as const }));
const env: Record<string, string | undefined> = {
  TELEGRAM_BOT_TOKEN: "bot-token",
  TELEGRAM_WEBHOOK_SECRET: "s3cret",
};

vi.mock("@/lib/db/admin", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/lib/env.server", () => ({
  get serverEnv() {
    return env;
  },
}));
vi.mock("@/lib/notifications/telegram-push", () => ({
  pushTelegramMessage: (a: PushArgs) => push(a),
}));

const { POST } = await import("@/app/api/telegram/webhook/route");

function req(body: unknown, secret?: string, raw?: string) {
  return new Request("https://x/api/telegram/webhook", {
    method: "POST",
    headers: secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret },
    body: raw ?? JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

const startUpdate = (text: string, chatId: number | string = 42) => ({
  message: { text, chat: { id: chatId } },
});

beforeEach(() => {
  vi.clearAllMocks();
  env.TELEGRAM_BOT_TOKEN = "bot-token";
  env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  rpc.mockResolvedValue({ data: { ok: true, display_name: "สมชาย" }, error: null });
});

describe("POST /api/telegram/webhook", () => {
  it("401s a wrong secret and NEVER touches the RPC", async () => {
    const res = await POST(req(startUpdate("/start abc123"), "wrong"));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("401s a MISSING secret header — absence must not be treated as trusted", async () => {
    const res = await POST(req(startUpdate("/start abc123")));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("503s when the env is unconfigured, rather than accepting the request", async () => {
    env.TELEGRAM_WEBHOOK_SECRET = undefined;
    const res = await POST(req(startUpdate("/start abc123"), "s3cret"));
    expect(res.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("binds on a valid /start and replies with the account NAME", async () => {
    const res = await POST(req(startUpdate("/start abc123"), "s3cret"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("consume_telegram_link_token", {
      p_token: "abc123",
      p_chat_id: "42",
    });
    const sent = push.mock.calls.at(0)?.at(0);
    expect(sent?.chatId).toBe("42");
    expect(sent?.text).toContain("สมชาย");
  });

  it("takes the chat id ONLY from chat.id — never from a from.id the body claims", async () => {
    const spoofed = {
      message: { text: "/start abc123", chat: { id: 42 }, from: { id: 999 } },
    };
    await POST(req(spoofed, "s3cret"));
    expect(rpc).toHaveBeenCalledWith(
      "consume_telegram_link_token",
      expect.objectContaining({ p_chat_id: "42" }),
    );
  });

  it("answers 200 — never 4xx — on unparseable JSON, or Telegram disables the webhook", async () => {
    const res = await POST(req(null, "s3cret", "not json{"));
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 200 and stays quiet on an update kind with no chat", async () => {
    const res = await POST(req({ edited_message: { text: "hi" } }, "s3cret"));
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("nudges non-/start chatter without calling the RPC", async () => {
    const res = await POST(req(startUpdate("สวัสดี"), "s3cret"));
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("answers 200 when the RPC errors, so Telegram does not retry-storm", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(req(startUpdate("/start abc123"), "s3cret"));
    expect(res.status).toBe(200);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
