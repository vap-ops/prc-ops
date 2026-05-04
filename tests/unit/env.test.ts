import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseEnv } from "@/lib/env";

describe("env schema — parseEnv", () => {
  it("parses a valid env without throwing", () => {
    expect(() =>
      parseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      }),
    ).not.toThrow();
  });

  it("rejects a malformed NEXT_PUBLIC_APP_URL", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" })).toThrow(
      /Invalid environment variables/,
    );
  });

  it("rejects a malformed NEXT_PUBLIC_SUPABASE_URL when provided", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).toThrow(
      /Invalid environment variables/,
    );
  });
});

describe("env schema — required Supabase vars at boot", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined as unknown as string);
    await expect(import("@/lib/env")).rejects.toThrow(/Invalid environment variables/);
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is a non-URL string", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    await expect(import("@/lib/env")).rejects.toThrow(/Invalid environment variables/);
  });

  it("throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    await expect(import("@/lib/env")).rejects.toThrow(/Invalid environment variables/);
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing or empty", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(import("@/lib/env")).rejects.toThrow(/Invalid environment variables/);
  });

  it("does NOT throw when LINE_CHANNEL_ID and LINE_CHANNEL_SECRET are absent", async () => {
    vi.stubEnv("LINE_CHANNEL_ID", undefined as unknown as string);
    vi.stubEnv("LINE_CHANNEL_SECRET", undefined as unknown as string);
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });
});
