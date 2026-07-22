// Writing failing test first.
//
// Spec 339 U1 — the honest "is this device on the current build?" line.
//
// The trap this component exists to avoid: /settings already renders
// `เวอร์ชัน {pkg.version}` from the SERVER, which is re-rendered on every request
// and therefore reads CURRENT even on a client stuck executing an old bundle.
// Telling a user to check that number is worse than telling them nothing — it
// says "you are up to date" at the exact moment they are not. The only value that
// actually goes stale is NEXT_PUBLIC_APP_VERSION, inlined into the client bundle
// at build time, so the verdict must come from comparing the two.
//
// clientEnv parses process.env once at import, so each case stubs the var and
// re-imports the module graph rather than mutating env after the fact.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(version: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_VERSION", version);
  return (await import("@/components/features/chrome/app-version-check")).AppVersionCheck;
}

describe("AppVersionCheck — spec 339 U1", () => {
  it("reports stale when the client bundle is behind the deployed build", async () => {
    const AppVersionCheck = await load("0.172.0");
    render(<AppVersionCheck deployed="0.173.0" />);
    expect(screen.getByText(/ยังใช้เวอร์ชัน/)).toBeInTheDocument();
    expect(screen.getByText("0.172.0")).toBeInTheDocument();
    expect(screen.getByText("0.173.0")).toBeInTheDocument();
    expect(screen.queryByText(/ใช้เวอร์ชันล่าสุดแล้ว/)).toBeNull();
  });

  it("ignores the Vercel commit suffix when comparing", async () => {
    const AppVersionCheck = await load("0.173.0+7f3a1c2");
    render(<AppVersionCheck deployed="0.173.0" />);
    expect(screen.getByText(/ใช้เวอร์ชันล่าสุดแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText(/ยังใช้เวอร์ชัน/)).toBeNull();
  });

  it("claims neither fresh nor stale when the client version is unknown", async () => {
    const AppVersionCheck = await load("");
    render(<AppVersionCheck deployed="0.173.0" />);
    expect(screen.getByText(/เวอร์ชันล่าสุดคือ/)).toBeInTheDocument();
    expect(screen.queryByText(/ใช้เวอร์ชันล่าสุดแล้ว/)).toBeNull();
    expect(screen.queryByText(/ยังใช้เวอร์ชัน/)).toBeNull();
  });

  it("never announces freshness in the SERVER pass, before the client bundle answers", async () => {
    // The pass a stranded client actually receives is the server's. If the verdict
    // were computed from the server's own build it would always read "up to date",
    // and the stale device would be told it is current. Pinning the server markup
    // is what stops the client snapshot being used as the server one.
    const AppVersionCheck = await load("0.173.0");
    const html = renderToStaticMarkup(<AppVersionCheck deployed="0.173.0" />);
    expect(html).not.toMatch(/ใช้เวอร์ชันล่าสุดแล้ว/);
    expect(html).not.toMatch(/ยังใช้เวอร์ชัน/);
    expect(html).toMatch(/เวอร์ชันล่าสุดคือ/);
  });
});
