import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Spec 244 U1c — the tracker is mounted app-wide (root layout) but must only
// engage on INTERNAL app surfaces. The consent notice in particular must never
// appear on a non-trackable route (unauth /login, external /client, /portal),
// even if it was queued while on a trackable route and the user then navigated
// away before acknowledging.

const nav = vi.hoisted(() => ({ path: "/sa" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import { TelemetryProvider } from "@/components/features/telemetry/telemetry-provider";

const NOTICE = { name: "ประกาศการวัดการใช้งาน" } as const;

afterEach(() => {
  cleanup();
  localStorage.clear();
  nav.path = "/sa";
});

describe("TelemetryProvider consent-notice gating", () => {
  it("shows the notice on a trackable route when not yet acknowledged", () => {
    localStorage.clear();
    nav.path = "/sa";
    render(<TelemetryProvider />);
    expect(screen.queryByRole("region", NOTICE)).not.toBeNull();
  });

  it("never shows the notice on a non-trackable route, even after it was queued", () => {
    localStorage.clear();
    nav.path = "/sa";
    const { rerender } = render(<TelemetryProvider />);
    expect(screen.queryByRole("region", NOTICE)).not.toBeNull(); // queued on /sa

    nav.path = "/login";
    rerender(<TelemetryProvider />);
    expect(screen.queryByRole("region", NOTICE)).toBeNull(); // gone on the public route
  });

  it("shows nothing when disabled by the kill switch", () => {
    localStorage.clear();
    nav.path = "/sa";
    render(<TelemetryProvider enabled={false} />);
    expect(screen.queryByRole("region", NOTICE)).toBeNull();
  });
});
