// Spec 334 follow-up — the muster cockpit page is MULTI-PARENT (project cockpit
// AND the /team hero). Its back chip must resolve ?from instead of hardcoding
// projectHref, mirroring /sa/registrations (the 313-U4 class). Source pins +
// mutation-checked (both directions) because the page is an async server
// component the RTL suite cannot render.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src", "app", "projects", "[projectId]", "muster", "page.tsx"),
  "utf8",
);

describe("muster page back chip", () => {
  it("resolves ?from via safeBackHref (usage, not just import)", () => {
    expect(src.split("safeBackHref").length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain("from?: string");
    // Pin the exact call shape — swapped args (wrong fallback) must red this
    // (fresh-eyes 334fix: occurrence-counting alone survives an arg swap).
    expect(src).toContain("safeBackHref(from, projectHref(projectId))");
  });
  it("no longer hardcodes the project back", () => {
    expect(src).not.toContain("backHref={projectHref(projectId)}");
  });
  it("threads crew leads into the cockpit (HT-only picker)", () => {
    expect(src.split("htWorkerIds").length - 1).toBeGreaterThanOrEqual(1);
    expect(src).toContain("lead_worker_id");
  });
});
