// Writing failing test first.
//
// Client WP-detail drill (extends spec 233/234) — loadClientWpDetail reads one
// work package + its approved photos through the RLS server client, reusing
// the EXISTING "client reads project work_packages" / "client reads approved
// project photos" arms (both already scope by project_id via
// client_has_live_access — no new RLS arm, no migration). Pins: NO money
// column ever selected; a WP outside the given project (or a forged id)
// returns null; superseded photos are anti-joined out; photos scoped to THIS
// wp only (not the whole project).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mintSignedUrls } = vi.hoisted(() => ({
  mintSignedUrls: vi.fn(
    async (_bucket: string, rows: ReadonlyArray<{ id: string; storage_path: string | null }>) =>
      new Map(rows.filter((r) => r.storage_path).map((r) => [r.id, `signed://${r.id}`])),
  ),
}));
vi.mock("@/lib/storage/signed-urls", () => ({ mintSignedUrls }));

import { loadClientWpDetail } from "@/lib/client-portal/load-client-wp-detail";

const selects: Record<string, string> = {};

function makeSupabase(rows: { wp: unknown; photos: unknown }) {
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
      if (table === "work_packages") return query(table, rows.wp);
      if (table === "photo_logs") return query(table, rows.photos);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const WP = {
  id: "wp1",
  project_id: "p1",
  code: "A1",
  name: "งานเสาเข็ม",
  status: "in_progress",
  description: "หล่อเสาเข็มทั้งหมด 40 ต้น",
  planned_start: "2026-01-01",
  planned_end: "2026-02-01",
};

beforeEach(() => {
  for (const k of Object.keys(selects)) delete selects[k];
  mintSignedUrls.mockClear();
});

describe("loadClientWpDetail", () => {
  it("returns null when the WP row is not visible (RLS) or belongs to a different project", async () => {
    const supabase = makeSupabase({ wp: null, photos: [] });
    expect(await loadClientWpDetail(supabase as never, "p1", "wp1")).toBeNull();
  });

  it("returns null when the WP's project_id does not match the given project (forged id)", async () => {
    const supabase = makeSupabase({ wp: { ...WP, project_id: "other" }, photos: [] });
    expect(await loadClientWpDetail(supabase as never, "p1", "wp1")).toBeNull();
  });

  it("selects NO money column on either surface", async () => {
    const supabase = makeSupabase({ wp: WP, photos: [] });
    await loadClientWpDetail(supabase as never, "p1", "wp1");
    const MONEY = /cost|amount|rate|budget|price|labor|sell|profit/i;
    for (const [table, cols] of Object.entries(selects)) {
      expect(cols, `${table} select must expose no money column`).not.toMatch(MONEY);
    }
  });

  it("returns the WP fields + its own approved photos, anti-joining superseded rows", async () => {
    const supabase = makeSupabase({
      wp: WP,
      photos: [
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
        {
          id: "tomb",
          work_package_id: "wp1",
          phase: "after",
          storage_path: null,
          created_at: "3",
          superseded_by: null,
        },
      ],
    });
    const detail = await loadClientWpDetail(supabase as never, "p1", "wp1");
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("wp1");
    expect(detail!.code).toBe("A1");
    expect(detail!.name).toBe("งานเสาเข็ม");
    expect(detail!.status).toBe("in_progress");
    expect(detail!.description).toBe("หล่อเสาเข็มทั้งหมด 40 ต้น");
    expect(detail!.plannedStart).toBe("2026-01-01");
    expect(detail!.plannedEnd).toBe("2026-02-01");
    expect(detail!.photos.map((p) => p.id)).toEqual(["new"]);
  });
});
