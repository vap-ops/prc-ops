// Feedback 10a15ebe — every client telemetry event shipped with app_version
// NULL (the DB column + ingest route already persist it; the client never sent
// a value). That blindness turned a field upload_fail 400 into a multi-PR
// guessing game: no way to tell a pre-deploy stale bundle from a real gap.
//
// RED first: the tracker's emit() does not thread a version, and next.config
// does not inline one.

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseClientEnv } from "@/lib/env";
import { EventBuffer, type TelemetryEvent } from "@/lib/telemetry/session";
import { UsageTracker } from "@/lib/telemetry/tracker";
import nextConfig from "../../next.config";
import pkg from "../../package.json";

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

describe("telemetry app_version (feedback 10a15ebe)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stamps every emitted event with the tracker's app version", () => {
    const captured: TelemetryEvent[] = [];
    vi.spyOn(EventBuffer.prototype, "add").mockImplementation((e: TelemetryEvent) => {
      captured.push(e);
    });

    const tracker = new UsageTracker("9.9.9-test");
    tracker.start(); // emits session_start
    tracker.trackFriction("upload_fail", { kind: "phase_photo", stage: "storage" });
    tracker.stop();

    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured.every((e) => e.app_version === "9.9.9-test")).toBe(true);
    const uploadFail = captured.find((e) => e.event_type === "upload_fail");
    expect(uploadFail?.app_version).toBe("9.9.9-test");
  });

  it("inlines the build version as NEXT_PUBLIC_APP_VERSION via next.config", () => {
    const injected = nextConfig.env?.NEXT_PUBLIC_APP_VERSION;
    expect(typeof injected).toBe("string");
    expect(injected).toBeTruthy();
    expect(injected?.startsWith(pkg.version)).toBe(true);
  });

  it("carries NEXT_PUBLIC_APP_VERSION through the client-env SSOT", () => {
    // The default UsageTracker() reads clientEnv.NEXT_PUBLIC_APP_VERSION — prove
    // the schema accepts + surfaces it (env.ts is the only sanctioned reader).
    expect(
      parseClientEnv({ ...VALID_ENV, NEXT_PUBLIC_APP_VERSION: "1.2.3" }).NEXT_PUBLIC_APP_VERSION,
    ).toBe("1.2.3");
    // Unset stays optional — dev/test must not throw at import.
    expect(parseClientEnv(VALID_ENV).NEXT_PUBLIC_APP_VERSION).toBeUndefined();
  });
});
