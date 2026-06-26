import { describe, expect, it, vi } from "vitest";
import { pushTelegramMessage } from "@/lib/notifications/telegram-push";

describe("pushTelegramMessage", () => {
  it("POSTs to the bot sendMessage API with chat_id + text and reports ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    const result = await pushTelegramMessage({
      token: "bot-token",
      chatId: "123456",
      text: "ข้อเสนอแนะใหม่",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: "123456",
      text: "ข้อเสนอแนะใหม่",
      disable_web_page_preview: true,
    });
  });

  it("reports status and body on a non-ok response (e.g. bot blocked / chat not found)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('{"ok":false,"description":"chat not found"}', { status: 400 }),
      );

    const result = await pushTelegramMessage({ token: "t", chatId: "0", text: "x", fetchImpl });

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: '{"ok":false,"description":"chat not found"}',
    });
  });

  it("reports status 0 when the fetch itself throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await pushTelegramMessage({ token: "t", chatId: "0", text: "x", fetchImpl });

    expect(result).toEqual({ ok: false, status: 0, body: "network down" });
  });

  it("truncates text to Telegram's 4096-char limit so an oversized comment cannot poison the row", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    await pushTelegramMessage({ token: "t", chatId: "0", text: "ก".repeat(5000), fetchImpl });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { text: string };
    expect(body.text.length).toBe(4096);
  });
});
