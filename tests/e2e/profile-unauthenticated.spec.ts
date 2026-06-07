// E2E coverage for the unauthenticated /profile path. Mirrors
// tests/e2e/auth-unauthenticated.spec.ts: proxy.ts protects every
// non-public route, so an unauthenticated GET /profile must redirect
// to /login before the page's own auth check would run.
//
// Authenticated paths use the LINE flow and are exercised live, per
// feature spec 07's verification checklist. Same scope rationale as
// the auth-unauthenticated suite — see that file's header.
//
// Run locally with `pnpm test:e2e`.

import { test, expect } from "@playwright/test";

test.describe("profile route — unauthenticated", () => {
  test("GET /profile redirects to /login (proxy protection)", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL("/login");
  });
});
