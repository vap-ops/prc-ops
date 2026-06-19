// Spec 148 U4 — the projects-hub loader batches the client-name lookup with the
// PM-only create-sheet reads. RED first: concurrency (max in-flight >= 3 for a PM:
// client names ∥ suggested code ∥ clients; serial peaks at 1) + shape.

import { describe, it, expect, beforeEach } from "vitest";

import { loadProjectsHub } from "@/lib/projects/load-hub";

let inFlight = 0;
let maxInFlight = 0;

const PROJECTS = [{ id: "p1", code: "PRJ", name: "โปร", status: "active", client_id: "cl1" }];
const CLIENTS = [{ id: "cl1", name: "ลูกค้า" }];

const LIST: Record<string, unknown[]> = { projects: PROJECTS, clients: CLIENTS };
const RPC: Record<string, unknown> = { suggest_project_code: "PRJ-002" };

function makeQuery(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((r) => setTimeout(r, 5))
      .then(() => {
        inFlight--;
        return { data: LIST[table] ?? [], error: null };
      })
      .then(resolve, reject);
  };
  return q;
}

const supabase = {
  from: (table: string) => makeQuery(table),
  rpc: (name: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((r) => setTimeout(r, 5)).then(() => {
      inFlight--;
      return { data: RPC[name] ?? null, error: null };
    });
  },
} as never;

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("loadProjectsHub", () => {
  it("runs client names + suggested code + clients concurrently for a PM", async () => {
    await loadProjectsHub(supabase, true);
    expect(maxInFlight).toBeGreaterThanOrEqual(3);
  });

  it("assembles the correct shape", async () => {
    const data = await loadProjectsHub(supabase, true);
    expect(data.projects).toEqual(PROJECTS);
    expect(data.error).toBeNull();
    expect(data.clientNames.get("cl1")).toBe("ลูกค้า");
    expect(data.suggestedCode).toBe("PRJ-002");
    expect(data.allClients).toEqual(CLIENTS);
  });

  it("skips the PM-only reads for non-PM", async () => {
    const data = await loadProjectsHub(supabase, false);
    expect(data.suggestedCode).toBe("");
    expect(data.allClients).toEqual([]);
    expect(data.clientNames.get("cl1")).toBe("ลูกค้า");
  });
});
