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
});
