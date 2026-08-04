// Spec 394 §7 — "selected" with nothing selected must REFUSE before inserting
// a row. It must not silently fall back to `after` (that hands someone a
// document they did not ask for) and must not queue a job that builds an empty
// PDF. The form disables the option; this is the server-side backstop for a
// stale form or a direct call.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
const getActionUser = vi.fn();
const runReportJob = vi.fn();

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser: () => getActionUser() as unknown,
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
}));
vi.mock("@/lib/auth/apply-assumed-role", () => ({
  applyAssumedRole: (r: unknown) => Promise.resolve(r),
}));
vi.mock("@/lib/db/admin", () => ({ createClient: () => ({ rpc, storage: { from } }) }));
vi.mock("@/lib/reports/run-report-job", () => ({
  runReportJob: (...a: unknown[]) => runReportJob(...a) as unknown,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { generateReport } from "@/app/projects/[projectId]/reports/actions";

const PROJECT = "11111111-1111-1111-1111-111111111111";

/** Minimal PostgREST double: each table answers the one shape the action reads. */
function makeSupabase(selectedCount: number) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const client = {
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { role: "project_manager" } }),
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: PROJECT } }) }),
          }),
        };
      }
      if (table === "reports") {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: [] }) }),
          insert,
        };
      }
      if (table === "report_selected_photos") {
        // .select(...).eq(project).in(phases) — the phase filter matters: the
        // guard must count only what the resolver can actually print.
        return {
          select: () => ({
            eq: () => ({ in: () => Promise.resolve({ count: selectedCount, data: [] }) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    insert,
  };
  return { client, insert };
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  runReportJob.mockReset();
  getActionUser.mockReset();
});

describe("generateReport with photos=selected (spec 394 §7)", () => {
  it("REFUSES at zero selected, and inserts nothing", async () => {
    const { client, insert } = makeSupabase(0);
    getActionUser.mockResolvedValue({ supabase: client, user: { id: "u1" } });

    const res = await generateReport({
      projectId: PROJECT,
      params: { scope: "complete", photos: "selected" },
    });

    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
    // and it must NOT quietly become a different report
    if (!res.ok) expect(res.reason).toContain("เลือกรูป");
  });

  it("proceeds when photos ARE selected", async () => {
    const { client, insert } = makeSupabase(2);
    getActionUser.mockResolvedValue({ supabase: client, user: { id: "u1" } });

    const res = await generateReport({
      projectId: PROJECT,
      params: { scope: "complete", photos: "selected" },
    });

    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalled();
  });

  it("does not run the zero-check for the other modes", async () => {
    // A project with no selections must still be able to generate an ordinary
    // report — the guard is scoped to the mode that needs it.
    const { client, insert } = makeSupabase(0);
    getActionUser.mockResolvedValue({ supabase: client, user: { id: "u1" } });

    const res = await generateReport({
      projectId: PROJECT,
      params: { scope: "complete", photos: "after" },
    });

    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalled();
  });
});
