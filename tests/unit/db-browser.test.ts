import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateBrowserClient = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mockCreateBrowserClient,
}));

import { createClient } from "@/lib/db/browser";

describe("db/browser createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateBrowserClient.mockReturnValue({});
  });

  it("calls createBrowserClient with URL and anon key", () => {
    createClient();

    expect(mockCreateBrowserClient).toHaveBeenCalledOnce();
    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-anon-key",
    );
  });
});
