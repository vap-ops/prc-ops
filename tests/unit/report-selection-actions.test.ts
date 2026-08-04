// Spec 394 U2 — report-selection actions. The 42501/22023 → honest-copy
// branches are the module's whole value: a permanent refusal must never read
// as "ลองใหม่", and the role gate must run before any RPC call.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args) as unknown,
}));
vi.mock("@/lib/db/server", () => ({
  createClient: () => Promise.resolve({ rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  reorderReportPhotos,
  selectReportPhoto,
  unselectReportPhoto,
} from "@/lib/reports/report-selection-actions";

const W = "22222222-2222-2222-2222-222222222222";
const PH = "33333333-3333-3333-3333-333333333333";
const PH2 = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: "u", role: "project_manager" });
  rpc.mockReset().mockResolvedValue({ data: { changed: true }, error: null });
});

describe("report-selection-actions", () => {
  it("gates on PM_ROLES — wider than starring, deliberately (D5)", async () => {
    await selectReportPhoto(W, PH);
    const roles = requireRole.mock.calls[0]?.[0] as string[];
    expect([...roles].sort()).toEqual(["project_director", "project_manager", "super_admin"]);
    expect(rpc).toHaveBeenCalledWith("select_report_photo", { p_photo_log_id: PH });
  });

  it("unselect calls the unselect RPC", async () => {
    await unselectReportPhoto(W, PH);
    expect(rpc).toHaveBeenCalledWith("unselect_report_photo", { p_photo_log_id: PH });
  });

  it("reorder sends the WHOLE list, not a delta", async () => {
    await reorderReportPhotos(W, [PH2, PH]);
    expect(rpc).toHaveBeenCalledWith("reorder_report_photos", {
      p_work_package_id: W,
      p_photo_ids: [PH2, PH],
    });
  });

  it("refuses malformed uuids WITHOUT touching the RPC", async () => {
    const res = await selectReportPhoto(W, "not-a-uuid");
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a reorder list containing a malformed uuid, untouched RPC", async () => {
    const res = await reorderReportPhotos(W, [PH, "nope"]);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("42501 maps to the role refusal — and never says ลองใหม่", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    const res = await selectReportPhoto(W, PH);
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain("ลองใหม่");
    expect(res.error).not.toContain("ลองอีกครั้ง");
  });

  it("22023 maps to the validity refusal — and never says ลองใหม่", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "x" } });
    const res = await selectReportPhoto(W, PH);
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain("ลองใหม่");
    expect(res.error).not.toContain("ลองอีกครั้ง");
  });

  // The stale-list refusal is the one a user will actually hit while
  // arranging, and it is ACTIONABLE — unlike the other two it should tell them
  // what to do (re-read), which is why reorder maps 22023 to its own copy.
  it("a stale reorder list gets its own copy telling the user to refresh", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "x" } });
    const res = await reorderReportPhotos(W, [PH, PH2]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("รีเฟรช");
  });

  it("an unexpected SQLSTATE stays retryable — only PERMANENT refusals lose ลองใหม่", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    const res = await selectReportPhoto(W, PH);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ลองใหม่");
  });
});
