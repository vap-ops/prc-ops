import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The autonomous-build danger-path guard (.github/workflows/ci.yml) FAILS its
// required check — and so HOLDS a PR for the operator's manual merge — when the
// PR touches a protected path. The `deny='...'` regex in that job is the SSOT
// for "what an autonomous PR must never auto-merge".
//
// This test locks src/app/auth/** into that regex. Those are the session-minting
// / LINE-OAuth-callback / login-handoff / logout route handlers; the gap where
// the regex covered src/lib/auth/ but NOT src/app/auth/ let #455 (a session-mint
// route) and #461 (an auth-page CSS fix) auto-merge UNHELD. It also guards
// against the opposite failure — over-broadening the regex so ordinary app
// routes start getting held.

// Vitest runs from the repo root, so the workflow file is a stable relative path.
const ciYml = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

function denyRegex(): RegExp {
  const match = ciYml.match(/deny='([^']+)'/);
  if (!match || !match[1]) {
    throw new Error("could not find deny='...' in the ci.yml danger-path guard");
  }
  return new RegExp(match[1]);
}

describe("danger-path guard deny-regex", () => {
  const deny = denyRegex();

  it("protects the session / OAuth route handlers under src/app/auth/", () => {
    expect(deny.test("src/app/auth/sandbox-link/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/line/callback/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/line/start/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/logout/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/handoff/start/route.ts")).toBe(true);
    expect(deny.test("src/app/auth/handoff/poll/route.ts")).toBe(true);
  });

  it("protects the photo/storage client pipeline (feedback 10a15ebe follow-up)", () => {
    // The photo upload/downscale/offline-queue pipeline and storage bucket helpers
    // are the client side of a security-relevant surface (Storage RLS + append-only
    // photo_logs); a code change there should be operator-reviewed, not auto-merged.
    expect(deny.test("src/lib/photos/upload-queue.ts")).toBe(true);
    expect(deny.test("src/lib/photos/downscale.ts")).toBe(true);
    expect(deny.test("src/components/features/photos/upload-queue-runner.tsx")).toBe(true);
    expect(deny.test("src/lib/storage/buckets.ts")).toBe(true);
  });

  it("still protects the pre-existing danger paths (no regression)", () => {
    expect(deny.test("src/lib/auth/session.ts")).toBe(true);
    expect(deny.test("src/lib/db/admin.ts")).toBe(true);
    expect(deny.test("supabase/migrations/075999_x.sql")).toBe(true);
    expect(deny.test("src/lib/notifications/outbox.ts")).toBe(true);
    expect(deny.test(".github/workflows/ci.yml")).toBe(true);
    expect(deny.test("CLAUDE.md")).toBe(true);
  });

  it("does NOT over-match benign app routes, lib, or components", () => {
    expect(deny.test("src/app/sa/page.tsx")).toBe(false);
    expect(deny.test("src/app/dashboard/page.tsx")).toBe(false);
    expect(deny.test("src/app/auth-widget/page.tsx")).toBe(false);
    expect(deny.test("src/lib/format.ts")).toBe(false);
    expect(deny.test("src/components/ui/button.tsx")).toBe(false);
    // Deliberate scope boundary: the WP page dir is too broad to hold wholesale
    // (it would freeze every unrelated WP-detail change). The photo pipeline it
    // imports (src/lib/photos/**) IS held, so most photo-write changes are caught.
    expect(
      deny.test("src/app/projects/[projectId]/work-packages/[workPackageId]/capture-sheet.tsx"),
    ).toBe(false);
  });
});
