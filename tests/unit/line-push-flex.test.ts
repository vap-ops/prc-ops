// Spec 212 — pushLineFlex: the Flex-Message sibling of pushLineMessage. Sends a
// LINE Flex bubble (the daily report) to one recipient. Mirrors the text push's
// contract (token + to, ok/status/body result) with a 400-char altText cap.

import { describe, expect, it, vi } from "vitest";
import { pushLineFlex } from "@/lib/notifications/line-push";

describe("pushLineFlex", () => {
  it("POSTs a flex message with altText + contents and reports ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const contents = { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } };

    const result = await pushLineFlex({
      token: "channel-token",
      to: "U1234567890",
      altText: "รายงานประจำวัน",
      contents,
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
      messages: [{ type: "flex", altText: "รายงานประจำวัน", contents }],
    });
  });

  it("truncates altText to LINE's 400-char limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await pushLineFlex({ token: "t", to: "U0", altText: "ก".repeat(600), contents: {}, fetchImpl });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { messages: Array<{ altText: string }> };
    expect(body.messages[0]?.altText.length).toBe(400);
  });

  it("reports status + body on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"bad"}', { status: 400 }));

    const result = await pushLineFlex({
      token: "t",
      to: "U0",
      altText: "x",
      contents: {},
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, status: 400, body: '{"message":"bad"}' });
  });

  it("reports status 0 when the fetch itself throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await pushLineFlex({
      token: "t",
      to: "U0",
      altText: "x",
      contents: {},
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, status: 0, body: "network down" });
  });
});
