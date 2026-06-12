import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateServerClient, cookieStore } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  cookieStore: new Map<string, string>(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [...cookieStore.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => cookieStore.set(name, value),
  }),
}));

import { createClient } from "@/lib/db/server";

describe("db/server createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieStore.clear();
    mockCreateServerClient.mockReturnValue({});
  });

  it("calls createServerClient with URL and anon key", async () => {
    await createClient();

    expect(mockCreateServerClient).toHaveBeenCalledOnce();
    const [url, key] = mockCreateServerClient.mock.calls[0]!;
    expect(url).toBe("https://test.supabase.co");
    expect(key).toBe("test-anon-key");
  });

  it("passes a cookies object with getAll and setAll", async () => {
    cookieStore.set("session", "abc");
    await createClient();

    const cookiesArg = mockCreateServerClient.mock.calls[0]![2].cookies;
    expect(cookiesArg.getAll()).toEqual([{ name: "session", value: "abc" }]);
  });

  it("setAll forwards each cookie to the store via set()", async () => {
    await createClient();

    const cookiesArg = mockCreateServerClient.mock.calls[0]![2].cookies;
    cookiesArg.setAll([{ name: "auth", value: "token", options: { httpOnly: true } }]);
    expect(cookieStore.get("auth")).toBe("token");
  });
});
