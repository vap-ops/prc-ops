// Spec 318 U4 — /settings/notifications server actions: saveNotificationPreference
// (RPC passthrough, refuses locked events early) + sendTestNotification (own-LINE
// push, honest Thai errors when unreachable).

import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const getActionUserMock = vi.fn();
const selfSelectMock = vi.fn();
const pushLineMessageMock = vi.fn();
// hoisted so the vi.mock factory (also hoisted) can close over it safely
const envMock = vi.hoisted(
  () =>
    ({ LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "line-token" }) as {
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: string | undefined;
    },
);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser: () => getActionUserMock(),
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
}));
vi.mock("@/lib/notifications/line-push", () => ({
  pushLineMessage: (args: unknown) => pushLineMessageMock(args),
}));
vi.mock("@/lib/env.server", () => ({ serverEnv: envMock }));

import {
  saveNotificationChannelPreference,
  saveNotificationPreference,
  sendTestNotification,
} from "@/app/settings/notifications/actions";

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ error: null });
  selfSelectMock.mockReset().mockResolvedValue({ data: { line_user_id: "Lme" }, error: null });
  getActionUserMock.mockReset().mockResolvedValue({
    user: { id: "u1" },
    supabase: {
      rpc: (...a: unknown[]) => rpcMock(...a),
      // the RLS-scoped own-row read (users read self policy)
      from: () => ({ select: () => ({ eq: () => ({ single: async () => selfSelectMock() }) }) }),
    },
  });
  pushLineMessageMock.mockReset().mockResolvedValue({ ok: true });
  envMock.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "line-token";
});

// Spec 390 — the per-channel action. The SQLSTATE mapping below had NO coverage
// when it was written: the form test feeds the Thai string through a MOCKED
// action, so deleting the 22023 branch left every test green while a permanent
// refusal silently degraded to "กรุณาลองใหม่" — the honest-copy defect the
// branch exists to prevent (spec 387 U1's class).
describe("saveNotificationChannelPreference", () => {
  it("passes the channel and enabled flag straight to the RPC", async () => {
    const r = await saveNotificationChannelPreference("line", false);
    expect(r).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("set_notification_channel_preference", {
      p_channel: "line",
      p_enabled: false,
    });
  });

  it("maps the floor's 22023 to a PERMANENT reason, never a retry", async () => {
    rpcMock.mockResolvedValue({
      error: { code: "22023", message: "no reachable notification channel would remain" },
    });
    const r = await saveNotificationChannelPreference("telegram", false);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("ปิดไม่ได้");
    expect(r.error).not.toContain("ลองใหม่");
  });

  it("still offers a retry for a genuinely transient failure", async () => {
    rpcMock.mockResolvedValue({ error: { code: "08006", message: "connection failure" } });
    const r = await saveNotificationChannelPreference("line", false);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("ลองใหม่");
  });

  it("refuses when signed out, without calling the RPC", async () => {
    getActionUserMock.mockResolvedValue(null);
    const r = await saveNotificationChannelPreference("line", false);
    expect(r).toEqual({ ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("saveNotificationPreference", () => {
  it("passes an unlocked event to the RPC", async () => {
    const r = await saveNotificationPreference("pr_progress", false);
    expect(r).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("set_notification_preference", {
      p_event: "pr_progress",
      p_enabled: false,
    });
  });

  it("refuses a locked event early — no RPC call", async () => {
    const r = await saveNotificationPreference("site_issue_reported", false);
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("errors when not signed in", async () => {
    getActionUserMock.mockResolvedValue(null);
    const r = await saveNotificationPreference("pr_progress", false);
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("sendTestNotification", () => {
  it("pushes to the caller's own LINE id", async () => {
    const r = await sendTestNotification();
    expect(r).toEqual({ ok: true });
    expect(pushLineMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "Lme", token: "line-token" }),
    );
  });

  it("returns a Thai error when the caller has no LINE id", async () => {
    selfSelectMock.mockResolvedValue({ data: { line_user_id: null }, error: null });
    const r = await sendTestNotification();
    expect(r.ok).toBe(false);
    expect(pushLineMessageMock).not.toHaveBeenCalled();
  });

  it("errors when the LINE channel token is unset (no push attempt)", async () => {
    envMock.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = undefined;
    const r = await sendTestNotification();
    expect(r.ok).toBe(false);
    expect(pushLineMessageMock).not.toHaveBeenCalled();
  });

  it("maps a LINE 403 to the add-friend hint", async () => {
    pushLineMessageMock.mockResolvedValue({ ok: false, status: 403, body: "forbidden" });
    const r = await sendTestNotification();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("เพิ่มเพื่อน");
  });

  // Spec 387 U1 — honest-copy class. A 429 is the OA's MONTHLY quota: it cannot
  // succeed on a retry until the billing cycle rolls, so "กรุณาลองใหม่" is a lie
  // that sends the user back to press a button that is guaranteed to refuse.
  // This was live from 2026-07-22 and still refusing ten days later.
  it("maps a LINE 429 quota refusal to a NON-retryable message", async () => {
    pushLineMessageMock.mockResolvedValue({
      ok: false,
      status: 429,
      body: '{"message":"You have reached your monthly limit."}',
    });
    const r = await sendTestNotification();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("โควตา");
      // the exact wording that made it dishonest
      expect(r.error).not.toBe("ส่งข้อความทดสอบไม่สำเร็จ กรุณาลองใหม่");
    }
  });

  it("still tells a genuinely retryable failure to retry", async () => {
    pushLineMessageMock.mockResolvedValue({ ok: false, status: 500, body: "boom" });
    const r = await sendTestNotification();
    expect(r.ok).toBe(false);
    // positive control: without this, "429 is not the generic message" would
    // also pass if the generic arm had been deleted outright.
    if (!r.ok) expect(r.error).toContain("ลองใหม่");
  });
});
