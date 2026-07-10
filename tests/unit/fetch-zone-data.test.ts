// Spec 289 U2 — fetchLaborZoneData dedupe seams. RED first:
// (1) it returns projectWorkers ({id,name} of the project's active crew, read
//     order preserved) so the WP-detail page can drop its own workers read;
// (2) an optional shared-contractors promise replaces its own contractors read
//     (the WP-detail loader already reads a superset of the same table).
// Without the option the read stays — the /review WP page path is unchanged.

import { describe, it, expect } from "vitest";

import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";

const WORKERS = [
  {
    id: "w1",
    name: "สมชาย",
    pay_type: "daily",
    contractor_id: null,
    active: true,
    project_id: "p1",
  },
  {
    id: "w2",
    name: "สมหญิง",
    pay_type: "daily",
    contractor_id: "c1",
    active: true,
    project_id: "p2",
  },
  {
    id: "w3",
    name: "อนันต์",
    pay_type: "daily",
    contractor_id: null,
    active: false,
    project_id: "p1",
  },
  {
    id: "w4",
    name: "อาทิตย์",
    pay_type: "daily",
    contractor_id: null,
    active: true,
    project_id: "p1",
  },
];
const CONTRACTORS = [{ id: "c1", name: "ผู้รับเหมา ก" }];

function makeSupabase() {
  const tables: string[] = [];
  const DATA: Record<string, unknown[]> = {
    workers: WORKERS,
    contractors: CONTRACTORS,
    labor_logs: [],
  };
  function makeQuery(table: string) {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: DATA[table] ?? [], error: null }).then(resolve, reject);
    return q;
  }
  return {
    client: {
      from: (t: string) => {
        tables.push(t);
        return makeQuery(t);
      },
    } as never,
    tables,
  };
}

describe("fetchLaborZoneData", () => {
  it("returns the project's active workers as projectWorkers ({id,name}, read order)", async () => {
    const { client } = makeSupabase();
    const zone = await fetchLaborZoneData(client, "wp1", "p1");
    expect(zone.projectWorkers).toEqual([
      { id: "w1", name: "สมชาย" },
      { id: "w4", name: "อาทิตย์" },
    ]);
    // the pre-existing id list stays consistent with it
    expect(zone.projectWorkerIds).toEqual(["w1", "w4"]);
  });

  it("skips its own contractors read when a shared promise is provided", async () => {
    const { client, tables } = makeSupabase();
    const zone = await fetchLaborZoneData(
      client,
      "wp1",
      "p1",
      Promise.resolve([{ id: "c1", name: "ผู้รับเหมา ก" }]),
    );
    expect(tables).not.toContain("contractors");
    // the shared rows actually reach groupRoster — w2 (contractor c1) groups
    // under the shared contractor's name
    const c1Group = zone.roster.dc.find((g) => g.contractorId === "c1");
    expect(c1Group?.contractorName).toBe("ผู้รับเหมา ก");
  });

  it("reads contractors itself when no shared promise is given (review-page path)", async () => {
    const { client, tables } = makeSupabase();
    await fetchLaborZoneData(client, "wp1", "p1");
    expect(tables).toContain("contractors");
  });
});
