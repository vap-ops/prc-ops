import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("env schema", () => {
  it("parses an empty env without throwing (all vars optional in v0)", () => {
    expect(() => parseEnv({})).not.toThrow();
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
