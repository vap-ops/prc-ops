import { describe, it, expect, vi } from "vitest";

// `server-only` throws at module load outside of a React Server Components
// bundler context. Vitest runs in plain Node (jsdom env), so importing
// `@/lib/env.server` would crash without this mock.
vi.mock("server-only", () => ({}));

import { parseClientEnv } from "@/lib/env";
import { parseServerEnv } from "@/lib/env.server";

describe("parseClientEnv", () => {
  it("parses a valid client env without throwing", () => {
    expect(() =>
      parseClientEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).not.toThrow();
  });

  it("applies the NEXT_PUBLIC_APP_URL default when omitted", () => {
    const env = parseClientEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("accepts an overridden NEXT_PUBLIC_APP_URL", () => {
    const env = parseClientEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_APP_URL: "https://prc.example.com",
    });
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://prc.example.com");
  });

  it("rejects a malformed NEXT_PUBLIC_APP_URL", () => {
    expect(() =>
      parseClientEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
        NEXT_PUBLIC_APP_URL: "not-a-url",
      }),
    ).toThrow(/Invalid client environment variables/);
  });

  it("rejects a malformed NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(() =>
      parseClientEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toThrow(/Invalid client environment variables/);
  });

  it("rejects a missing NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(() =>
      parseClientEnv({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toThrow(/Invalid client environment variables/);
  });

  it("rejects an empty NEXT_PUBLIC_SUPABASE_ANON_KEY", () => {
    expect(() =>
      parseClientEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toThrow(/Invalid client environment variables/);
  });
});

describe("parseServerEnv", () => {
  const SERVICE_ROLE = "service-key";
  const CHANNEL_ID = "1234567890";
  const CHANNEL_SECRET = "channel-secret";

  it("parses a valid server env without throwing", () => {
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
        LINE_CHANNEL_ID: CHANNEL_ID,
        LINE_CHANNEL_SECRET: CHANNEL_SECRET,
      }),
    ).not.toThrow();
  });

  it("rejects a missing SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(() =>
      parseServerEnv({
        LINE_CHANNEL_ID: CHANNEL_ID,
        LINE_CHANNEL_SECRET: CHANNEL_SECRET,
      }),
    ).toThrow(/Invalid server environment variables/);
  });

  it("rejects an empty SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: "",
        LINE_CHANNEL_ID: CHANNEL_ID,
        LINE_CHANNEL_SECRET: CHANNEL_SECRET,
      }),
    ).toThrow(/Invalid server environment variables/);
  });

  it("rejects a missing LINE_CHANNEL_ID", () => {
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
        LINE_CHANNEL_SECRET: CHANNEL_SECRET,
      }),
    ).toThrow(/Invalid server environment variables/);
  });

  it("rejects an empty LINE_CHANNEL_ID", () => {
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
        LINE_CHANNEL_ID: "",
        LINE_CHANNEL_SECRET: CHANNEL_SECRET,
      }),
    ).toThrow(/Invalid server environment variables/);
  });

  it("rejects a missing LINE_CHANNEL_SECRET", () => {
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
        LINE_CHANNEL_ID: CHANNEL_ID,
      }),
    ).toThrow(/Invalid server environment variables/);
  });

  it("rejects an empty LINE_CHANNEL_SECRET", () => {
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
        LINE_CHANNEL_ID: CHANNEL_ID,
        LINE_CHANNEL_SECRET: "",
      }),
    ).toThrow(/Invalid server environment variables/);
  });
});
