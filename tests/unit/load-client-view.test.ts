// Writing failing test first.
//
// Spec 233 / ADR 0067 U4 — loadClientView reads the four read-only surfaces
// through the RLS server client (the client read arms scope the rows). Pins:
// NO money column is ever selected (projects.budget_amount_thb especially);
// superseded photos are anti-joined out; null when there is no live project.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mintSignedUrls } = vi.hoisted(() => ({
  mintSignedUrls: vi.fn(
    async (_bucket: string, rows: ReadonlyArray<{ id: string; storage_path: string | null }>) =>
      new Map(rows.filter((r) => r.storage_path).map((r) => [r.id, `signed://${r.id}`])),
  ),
}));
vi.mock("@/lib/storage/signed-urls", () => ({ mintSignedUrls }));

import { loadClientView } from "@/lib/client-portal/load-client-view";

const selects: Record<string, string> = {};

function makeSupabase(rows: {
  project: unknown;
  workPackages: unknown;
  photos: unknown;
  reports: unknown;
}) {
  function query(table: string, data: unknown) {
    const builder = {
      select(cols: string) {
        selects[table] = cols;
        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data });
      },
      then(onF: (v: { data: unknown }) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve({ data }).then(onF, onR);
      },
    };
    return builder;
  }
  return {
    from(table: string) {
      if (table === "projects") return query(table, rows.project);
      if (table === "work_packages") return query(table, rows.workPackages);
      if (table === "photo_logs") return query(table, rows.photos);
      if (table === "reports") return query(table, rows.reports);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const PROJECT = {
  id: "p1",
  code: "PRC-1",
  name: "Proj",
  status: "active",
  site_address: "addr",
  start_date: "2026-01-01",
  planned_completion_date: "2026-12-31",
};

beforeEach(() => {
  for (const k of Object.keys(selects)) delete selects[k];
  mintSignedUrls.mockClear();
});

describe("loadClientView", () => {
  it("returns null when there is no live-access project", async () => {
    const supabase = makeSupabase({ project: null, workPackages: [], photos: [], reports: [] });
    expect(await loadClientView(supabase as never)).toBeNull();
  });

  it("selects NO money columns on any surface", async () => {
    const supabase = makeSupabase({
      project: PROJECT,
      workPackages: [],
      photos: [],
      reports: [],
    });
    await loadClientView(supabase as never);
    const MONEY = /cost|amount|rate|budget|price|labor|sell|profit/i;
    for (const [table, cols] of Object.entries(selects)) {
      expect(cols, `${table} select must expose no money column`).not.toMatch(MONEY);
    }
  });

  it("returns the four surfaces, anti-joining superseded photos", async () => {
    const supabase = makeSupabase({
      project: PROJECT,
      workPackages: [{ id: "wp1", code: "A", name: "A", status: "complete" }],
      photos: [
        // old is superseded by new → only `new` survives
        {
          id: "old",
          work_package_id: "wp1",
          phase: "after",
          storage_path: "a",
          created_at: "1",
          superseded_by: null,
        },
        {
          id: "new",
          work_package_id: "wp1",
          phase: "after",
          storage_path: "b",
          created_at: "2",
          superseded_by: "old",
        },
        // a tombstone (null path) is dropped
        {
          id: "tomb",
          work_package_id: "wp1",
          phase: "after",
          storage_path: null,
          created_at: "3",
          superseded_by: null,
        },
      ],
      reports: [{ id: "r1", storage_path: "rep.pdf", created_at: "2026-06-01" }],
    });
    const view = await loadClientView(supabase as never);
    expect(view).not.toBeNull();
    expect(view!.project.id).toBe("p1");
    expect(view!.workPackages).toHaveLength(1);
    expect(view!.photos.map((p) => p.id)).toEqual(["new"]);
    expect(view!.reports.map((r) => r.id)).toEqual(["r1"]);
  });
});
