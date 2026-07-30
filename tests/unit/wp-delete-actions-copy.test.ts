import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mig 075875 widened delete_work_package's P0001 guard to every live WP
// reference (stock / GL / plans / provenance PRs / child WPs). The action's
// refusal copy must name the CLASS, not the old partial example list — a user
// blocked by a stock issue must not read a message about photos/teams/PRs.
const SRC_PATH = join(
  process.cwd(),
  "src/app/projects/[projectId]/work-packages/[workPackageId]/delete-actions.ts",
);

// Strip // comments so a comment quoting a string can never satisfy a pin.
function sourceWithoutComments(): string {
  return readFileSync(SRC_PATH, "utf8")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

describe("deleteWorkPackage refusal copy (mig 075875 guard widening)", () => {
  it("carries the class-level refusal copy exactly once (the declaration)", () => {
    const src = sourceWithoutComments();
    const copy = "ลบไม่ได้ — งานนี้มีประวัติการใช้งานหรือมีงานย่อยแล้ว (การยกเลิกงานจะมาเร็วๆนี้)";
    expect(src.split(copy).length - 1).toBe(1);
  });

  it("no longer carries the pre-075875 partial example list (bare)", () => {
    const src = sourceWithoutComments();
    expect(src).not.toContain("งานนี้มีรูป ทีมงาน หรือคำขอซื้อแล้ว");
  });

  it("still maps P0001 — and only P0001 — to the refusal copy (HAS_HISTORY used once beyond its declaration)", () => {
    const src = sourceWithoutComments();
    expect(src.split("HAS_HISTORY").length - 1).toBe(2);
    expect(src.split('"P0001"').length - 1).toBe(1);
  });
});
