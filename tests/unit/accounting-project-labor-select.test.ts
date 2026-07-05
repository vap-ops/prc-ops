// Writing failing test first.
//
// Spec 266 fallout fix — the accounting project cost page reads labor_logs via a
// string .select(). U1 renamed labor_logs.worker_type_snapshot →
// pay_type_snapshot (dropping the old column), and cost.ts's CostInputRow +
// aggregateLaborCost read pay_type_snapshot. The page's .select() string was
// missed in the U2 code repoint, so it named a now-dropped column → the query
// 400s at runtime and labor cost silently reads as zero. A string column name is
// invisible to typecheck, so pin it here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/app/accounting/projects/[projectId]/page.tsx"),
  "utf8",
);

describe("accounting project labor_logs select (spec 266 column rename)", () => {
  it("selects pay_type_snapshot, not the dropped worker_type_snapshot", () => {
    expect(src).toContain("pay_type_snapshot");
    expect(src).not.toContain("worker_type_snapshot");
  });
});
