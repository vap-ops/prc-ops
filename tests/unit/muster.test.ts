// Spec 277 P0 — summarizeMuster(): folds today's แผนวันนี้ crew into the one-line
// "ทีมงานวันนี้ · X/Y มาทำ" muster. Counts UNIQUE workers (a worker on two งานย่อย
// is one person), and returns the still-absent crew grouped by WP so the muster's
// "ทั้งหมดมาทำ" can log them all in one tap. Pure (no fetch), unit-testable.

import { describe, it, expect } from "vitest";
import { summarizeMuster, type MusterCrewGroup } from "@/lib/sa/muster";

const items: MusterCrewGroup[] = [
  {
    workPackageId: "wp1",
    crew: [
      { workerId: "w1", present: false },
      { workerId: "w2", present: true },
    ],
  },
  {
    workPackageId: "wp2",
    crew: [
      { workerId: "w3", present: false },
      { workerId: "w4", present: false },
    ],
  },
];

describe("summarizeMuster", () => {
  it("is all-zero for an empty plan", () => {
    expect(summarizeMuster([])).toEqual({ present: 0, total: 0, pending: [] });
  });

  it("counts unique present/total workers and groups the absent by WP", () => {
    const s = summarizeMuster(items);
    expect(s.present).toBe(1);
    expect(s.total).toBe(4);
    expect(s.pending).toEqual([
      { workPackageId: "wp1", workerIds: ["w1"] },
      { workPackageId: "wp2", workerIds: ["w3", "w4"] },
    ]);
  });

  it("omits a WP from pending when its whole crew is present", () => {
    const s = summarizeMuster([
      { workPackageId: "wp1", crew: [{ workerId: "w1", present: true }] },
    ]);
    expect(s.pending).toEqual([]);
    expect(s).toMatchObject({ present: 1, total: 1 });
  });

  it("counts a worker on two WPs once, and present if present on either", () => {
    const s = summarizeMuster([
      { workPackageId: "wp1", crew: [{ workerId: "w1", present: true }] },
      { workPackageId: "wp2", crew: [{ workerId: "w1", present: false }] },
    ]);
    expect(s.total).toBe(1);
    expect(s.present).toBe(1);
    // still absent on wp2 → wp2 is offered for a one-tap log
    expect(s.pending).toEqual([{ workPackageId: "wp2", workerIds: ["w1"] }]);
  });
});
