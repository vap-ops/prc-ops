// Spec 65 §A — shared server-action auth gate. Replaces the 22 copy-pasted
// getUser + Thai not-signed-in blocks. Each action keeps its own return
// shape; this pins the helper contract and the canonical message.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    auth: { getUser },
  }),
}));

import { NOT_SIGNED_IN, getActionUser } from "@/lib/auth/action-gate";

beforeEach(() => {
  getUser.mockReset();
});

describe("getActionUser", () => {
  it("returns null when there is no session user", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getActionUser()).toBeNull();
  });

  it("returns null on an auth error", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect(await getActionUser()).toBeNull();
  });

  it("returns the RLS-scoped client and the user when signed in", async () => {
    const user = { id: "11111111-1111-4111-8111-111111111111" };
    getUser.mockResolvedValue({ data: { user }, error: null });
    const result = await getActionUser();
    expect(result).not.toBeNull();
    expect(result?.user).toBe(user);
    expect(result?.supabase.auth.getUser).toBeDefined();
  });
});

describe("NOT_SIGNED_IN", () => {
  it("pins the canonical Thai message used across action modules", () => {
    expect(NOT_SIGNED_IN).toBe("ยังไม่ได้เข้าสู่ระบบ");
  });
});
