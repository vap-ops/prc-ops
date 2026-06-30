// Writing failing test first.
//
// Spec 234 / ADR 0067 U2 — loadClientProjects lists the client's live projects
// through the RLS server client (the "client reads own project" arm returns
// exactly the live ones). Pins: NO money column selected; [] when none.

import { describe, it, expect } from "vitest";

import { loadClientProjects } from "@/lib/client-portal/load-client-projects";

const selects: Record<string, string> = {};

function makeSupabase(rows: unknown) {
  return {
    from(table: string) {
      const builder = {
        select(cols: string) {
          selects[table] = cols;
          return builder;
        },
        order() {
          return builder;
        },
        then(onF: (v: { data: unknown }) => unknown, onR?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows }).then(onF, onR);
        },
      };
      return builder;
    },
  };
}

describe("loadClientProjects", () => {
  it("returns the live projects, no money column selected", async () => {
    const supabase = makeSupabase([
      { id: "p1", code: "PRC-1", name: "A", status: "active" },
      { id: "p2", code: "PRC-2", name: "B", status: "completed" },
    ]);
    const projects = await loadClientProjects(supabase as never);
    expect(projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(selects["projects"]).not.toMatch(/cost|amount|rate|budget|price|labor|sell|profit/i);
  });

  it("returns [] when the client has no live projects", async () => {
    const supabase = makeSupabase([]);
    expect(await loadClientProjects(supabase as never)).toEqual([]);
  });
});
