// E2E coverage for unauthenticated auth paths only. Deliberately scoped:
//
//   - Proxy protection of role-gated routes (unauthenticated /sa, /pm,
//     /coming-soon must redirect to /login).
//   - The unauthenticated render of / and /login (LINE login link present
//     and points at /auth/line/start).
//   - /login error-banner rendering for the three error codes.
//
// What this file deliberately does NOT cover: any authenticated-session test.
// Those need a dedicated test Supabase project so admin.generateLink +
// verifyOtp don't write fake users into the production auth.users table on
// every test/CI run (Playwright runs against the linked remote project per
// ADR 0006; there is no local Supabase). See the progress tracker —
// "Authenticated-path E2E" is logged as a deferred unit.
//
// Run locally with `pnpm test:e2e`. Playwright spins up `pnpm dev` per
// playwright.config.ts. Requires `.env.local` populated (Supabase URL + anon
// key for the home and /login server components' getUser() probe; LINE_CHANNEL_*
// for env.server.ts to boot). Not wired into CI — see the spec's PR 4 section
// for the rationale.

import { test, expect } from "@playwright/test";

test.describe("auth — unauthenticated paths", () => {
  // Spec 82 Unit 3: /projects is the folded project hub (/sa is now just a
  // config redirect onto it). Both end at /login when unauthenticated; test
  // the real protected hub.
  test("GET /projects redirects to /login (proxy protection)", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL("/login");
  });

  // Spec 82 Unit 4: /review is the content-named PM review queue (/pm is now
  // a config redirect onto it). Test the real protected hub.
  test("GET /review redirects to /login (proxy protection)", async ({ page }) => {
    await page.goto("/review");
    await expect(page).toHaveURL("/login");
  });

  test("GET /coming-soon redirects to /login (proxy protection)", async ({ page }) => {
    await page.goto("/coming-soon");
    await expect(page).toHaveURL("/login");
  });

  test("GET / renders the homepage with a LINE login link", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "PRC Ops", level: 1 })).toBeVisible();
    const loginLink = page.getByRole("link", { name: /เข้าสู่ระบบด้วย LINE/ });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute("href", "/auth/line/start");
  });

  test("GET /login renders the LINE login link", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL("/login");
    const loginLink = page.getByRole("link", { name: /เข้าสู่ระบบด้วย LINE/ });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute("href", "/auth/line/start");
  });

  // The banner is selected by data-testid rather than role="alert" because
  // Next.js injects its own hidden <div role="alert" id="__next-route-announcer__">
  // for a11y route changes — getByRole("alert") matches BOTH and trips
  // Playwright's strict-mode violation on Firefox (and is fragile on WebKit).
  // role="alert" is kept on the banner itself (correct semantics for an
  // assertive announcement); the test just needs a stable, single-match handle.
  test("GET /login?error=oauth_failed renders the error banner", async ({ page }) => {
    await page.goto("/login?error=oauth_failed");
    const banner = page.getByTestId("login-error");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/เข้าสู่ระบบไม่สำเร็จ/);
  });

  test("GET /login?error=session_failed renders the error banner", async ({ page }) => {
    await page.goto("/login?error=session_failed");
    const banner = page.getByTestId("login-error");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/ไม่สามารถเริ่มเซสชันได้/);
  });

  test("GET /login?error=unknown renders the error banner", async ({ page }) => {
    await page.goto("/login?error=unknown");
    const banner = page.getByTestId("login-error");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/เกิดข้อผิดพลาด/);
  });
});
