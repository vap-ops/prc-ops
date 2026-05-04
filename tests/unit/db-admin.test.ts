import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import { createClient } from "@/lib/db/admin";

describe("db/admin createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockReturnValue({});
  });

  it("calls createClient with URL, service role key, and auth options", () => {
    createClient();

    expect(mockCreateClient).toHaveBeenCalledOnce();
    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-service-role-key",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  });
});
