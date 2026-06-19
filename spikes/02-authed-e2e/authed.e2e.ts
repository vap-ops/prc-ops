// Spike 02 — the ONE green authed test.
//
// File is named `*.e2e.ts` (not `*.spec.ts`) on purpose: that keeps it OUT of
// the vitest spike glob (`spikes/**/*.{test,spec}.ts`) so `pnpm spike:test`
// never tries to run a Playwright file under vitest. The spike's Playwright
// config picks it up via `testMatch: ['**/*.e2e.ts']`.
//
// The session cookies come from the storageState written by global-setup.ts;
// no login UI is driven (ADR 0012 — the real LINE flow can't be scripted).

import { expect, test } from "@playwright/test";

test.describe("spike 02 — authenticated session via cookie injection", () => {
  test("GET /projects renders authenticated (not redirected to /login)", async ({ page }) => {
    const response = await page.goto("/projects");

    // The proxy middleware redirects unauthenticated requests to /login before
    // the page renders. Landing on /projects is the authentication proof.
    await expect(page).toHaveURL(/\/projects(\/|$|\?)/);
    expect(page.url()).not.toContain("/login");
    expect(response?.status() ?? 0).toBeLessThan(400);

    // Authenticated chrome the unauthenticated baseline never reaches: the
    // login link is the home/login marker, so its ABSENCE here corroborates
    // that we rendered an authed surface, not the public shell.
    await expect(
      page.getByRole("link", { name: /เข้าสู่ระบบด้วย LINE/ }),
    ).toHaveCount(0);
  });
});
