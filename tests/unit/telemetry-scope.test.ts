import { describe, expect, it } from "vitest";
import { isTrackableRoute } from "@/lib/telemetry/scope";

// Spec 244 U1c — usage telemetry captures every INTERNAL staff surface but must
// skip unauthenticated pages (so the consent notice never shows pre-login) and
// the external client/contractor portals (not "our roles").

describe("isTrackableRoute", () => {
  it("tracks internal app surfaces (any role's home + shared trees)", () => {
    for (const p of [
      "/sa",
      "/sa/work-packages/1",
      "/dashboard",
      "/requests",
      "/settings",
      "/settings/usage",
      "/projects/abc",
      "/review",
      "/catalog",
      "/accounting",
    ]) {
      expect(isTrackableRoute(p), p).toBe(true);
    }
  });

  it("skips the root dispatcher and unauthenticated pages", () => {
    for (const p of ["", "/", "/login", "/login/callback", "/coming-soon"]) {
      expect(isTrackableRoute(p), p).toBe(false);
    }
  });

  it("skips the external client + contractor portal tiers", () => {
    for (const p of ["/client", "/client/proj1", "/portal", "/portal/claim"]) {
      expect(isTrackableRoute(p), p).toBe(false);
    }
  });

  it("does not confuse a distinct route that merely shares a prefix", () => {
    // '/clients-report' is not the '/client' tier — only the exact segment or its
    // children are excluded.
    expect(isTrackableRoute("/clients-report")).toBe(true);
  });
});
