// Writing failing test first.
//
// Regression guard (2026-07-07): a stale spec-82-Unit-3 redirect
// `{ source: "/sa", destination: "/projects" }` survived when spec 192 revived
// /sa as the site_admin daily home (roleHome(site_admin) === "/sa", the
// แผนพรุ่งนี้ board lives under it). With the redirect in place, EVERY hit to
// /sa 307'd to /projects — the SA home + board were unreachable, and the หน้าหลัก
// tab (→ /sa) bounced to the project hub. This pins the bare-/sa redirect out.

import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config redirects", () => {
  it("does NOT redirect the bare /sa (it is the live site_admin home)", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const bareSa = redirects.find((r) => r.source === "/sa");
    expect(bareSa).toBeUndefined();
  });

  it("keeps the legacy /sa/projects/* deep-link redirect", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects.some((r) => r.source === "/sa/projects/:path*")).toBe(true);
  });
});
