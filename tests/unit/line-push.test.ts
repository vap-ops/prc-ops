import { describe, expect, it, vi } from "vitest";
import { pushLineMessage } from "@/lib/notifications/line-push";

describe("pushLineMessage", () => {
  it("POSTs the push payload with the channel token and reports ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await pushLineMessage({
      token: "channel-token",
      to: "U1234567890",
      text: "งานรอตรวจ: WP-001",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer channel-token",
          "content-type": "application/json",
        }),
      }),
    );
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      to: "U1234567890",
      messages: [{ type: "text", text: "งานรอตรวจ: WP-001" }],
    });
  });

  it("reports status and body on a non-ok response (e.g. non-friend recipient)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"not friend"}', { status: 400 }));

    const result = await pushLineMessage({
      token: "t",
      to: "U0",
      text: "x",
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, status: 400, body: '{"message":"not friend"}' });
  });

  it("reports status 0 when the fetch itself throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await pushLineMessage({ token: "t", to: "U0", text: "x", fetchImpl });

    expect(result).toEqual({ ok: false, status: 0, body: "network down" });
  });

  it("truncates text to LINE's 5000-char limit so an oversized comment cannot poison the row", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await pushLineMessage({ token: "t", to: "U0", text: "ก".repeat(6000), fetchImpl });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { messages: Array<{ text: string }> };
    expect(body.messages[0]?.text.length).toBe(5000);
  });
});
