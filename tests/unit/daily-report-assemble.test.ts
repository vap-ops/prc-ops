// Spec 212 U2 — assembleAttendance: the pure mapper from a day's labour rows into
// the report's by-work grouping (the spine), with per-type headcount and late/OT
// tallies. Work is the group; worker type is a tag; a null work package falls into
// the "งานทั่วไป" (general site work) bucket, which sorts last.

import { describe, it, expect } from "vitest";
import {
  assembleAttendance,
  type AttendanceLaborRow,
  type AttendanceWorkPackage,
} from "@/lib/daily-report/assemble";

const wps: AttendanceWorkPackage[] = [
  { id: "wp-f", code: "WP-F", name: "ฐานราก", deliverableCode: "D03" },
  { id: "wp-w", code: "WP-W", name: "ผนัง", deliverableCode: "D04" },
];

const labor: AttendanceLaborRow[] = [
  {
    workerId: "s1",
    workerName: "ช่างนัน",
    workerType: "subcon",
    workPackageId: "wp-f",
    exception: { name: "ช่างนัน", kind: "ot", detail: "+1 ชม." },
  },
  { workerId: "d1", workerName: "วีระชาต", workerType: "daily", workPackageId: "wp-w" },
  {
    workerId: "d2",
    workerName: "อรปรีญา",
    workerType: "daily",
    workPackageId: "wp-w",
    exception: { name: "อรปรีญา", kind: "late", detail: "มา 09:30" },
  },
  // general site work (no WP)
  { workerId: "d3", workerName: "สุบิน", workerType: "daily", workPackageId: null },
  // same worker logged to a second WP — counts once in the total
  { workerId: "d1", workerName: "วีระชาต", workerType: "daily", workPackageId: "wp-f" },
];

describe("assembleAttendance (spec 212 U2)", () => {
  it("groups by work package, general (null WP) bucket last", () => {
    const a = assembleAttendance(labor, wps);
    expect(a.entries.map((e) => e.wpId)).toEqual(["wp-f", "wp-w", null]);
    expect(a.entries.at(-1)?.title).toBe("งานทั่วไป");
    expect(a.entries.at(-1)?.wpCode).toBeNull();
  });

  it("carries WP identity (title + deliverable code) and the crew", () => {
    const a = assembleAttendance(labor, wps);
    const f = a.entries.find((e) => e.wpId === "wp-f")!;
    expect(f.title).toBe("ฐานราก");
    expect(f.wpCode).toBe("D03");
    expect(f.workers.map((w) => w.name).sort()).toEqual(["ช่างนัน", "วีระชาต"].sort());
  });

  it("per-WP headcount counts the crew in that WP", () => {
    const a = assembleAttendance(labor, wps);
    expect(a.entries.find((e) => e.wpId === "wp-w")!.headcount).toBe(2);
  });

  it("total headcount de-dupes a worker logged to two WPs", () => {
    const a = assembleAttendance(labor, wps);
    // distinct workers: s1, d1, d2, d3 = 4 (d1 is on wp-w AND wp-f)
    expect(a.totalHeadcount).toBe(4);
  });

  it("counts headcount by worker type (distinct workers)", () => {
    const a = assembleAttendance(labor, wps);
    expect(a.headcountByType).toEqual({ company: 0, daily: 3, subcon: 1 });
  });

  it("tallies late and OT exceptions", () => {
    const a = assembleAttendance(labor, wps);
    expect(a.lateCount).toBe(1);
    expect(a.otCount).toBe(1);
    const f = a.entries.find((e) => e.wpId === "wp-f")!;
    expect(f.exceptions).toEqual([{ name: "ช่างนัน", kind: "ot", detail: "+1 ชม." }]);
  });

  it("is empty for no labour", () => {
    const a = assembleAttendance([], wps);
    expect(a.entries).toEqual([]);
    expect(a.totalHeadcount).toBe(0);
    expect(a.headcountByType).toEqual({ company: 0, daily: 0, subcon: 0 });
  });
});
