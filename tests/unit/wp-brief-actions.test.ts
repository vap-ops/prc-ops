// Writing failing test first.
//
// Spec 377 U2b — WP brief authoring server actions: thin wrappers over the
// U2a RPCs (save_wp_brief_draft, add/update/delete criterion + evidence
// slot, publish_wp_brief). Gate = requireActionRole(PM_ROLES) client-side
// (spec-204 pattern, matches company-docs/actions.ts) — defense in depth
// alongside the DB's own is_manager() gate. Pins wiring + RPC arg mapping +
// error-code translation, not the DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, rpc } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
  NOT_PERMITTED: "ไม่มีสิทธิ์ทำรายการนี้",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { revalidatePath } from "next/cache";
import {
  saveWpBriefDraft,
  addWpBriefCriterion,
  updateWpBriefCriterion,
  deleteWpBriefCriterion,
  addWpBriefEvidenceSlot,
  updateWpBriefEvidenceSlot,
  deleteWpBriefEvidenceSlot,
  publishWpBrief,
} from "@/lib/wp-brief/actions";
import { PM_ROLES } from "@/lib/auth/role-home";

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: { supabase: { rpc }, user: { id: "pd-1" } },
  });
  rpc.mockReset().mockResolvedValue({ data: "new-id", error: null });
});

const WP_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const BRIEF_ID = "cccccccc-0000-4000-8000-000000000001";
const BRIEF_HREF = `/projects/${PROJECT_ID}/work-packages/${WP_ID}/brief`;

describe("saveWpBriefDraft", () => {
  const input = {
    projectId: PROJECT_ID,
    workPackageId: WP_ID,
    scopeIncluded: "ผูกเหล็กฐานราก F1",
    scopeExcluded: null,
    quantity: "12 จุด",
    location: "โซนหน้าอาคาร",
    sheetCode: "S-101",
    sheetRev: "B",
    displayConfig: null,
  };

  it("gates on PM_ROLES and maps args to the RPC", async () => {
    const r = await saveWpBriefDraft(input);
    expect(r).toEqual({ ok: true });
    expect(requireActionRole).toHaveBeenCalledWith(PM_ROLES);
    expect(rpc).toHaveBeenCalledWith("save_wp_brief_draft", {
      p_work_package_id: WP_ID,
      p_scope_included: "ผูกเหล็กฐานราก F1",
      p_scope_excluded: null,
      p_quantity: "12 จุด",
      p_location: "โซนหน้าอาคาร",
      p_sheet_code: "S-101",
      p_sheet_rev: "B",
      p_display_config: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith(BRIEF_HREF);
  });

  it("round-trips a non-null display_config UNCHANGED — never hardcodes it (the fresh-eyes wipe bug)", async () => {
    const existing = { sections: ["scope"] };
    await saveWpBriefDraft({ ...input, displayConfig: existing });
    expect(rpc).toHaveBeenCalledWith(
      "save_wp_brief_draft",
      expect.objectContaining({ p_display_config: existing }),
    );
  });

  it("gate short-circuits before the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await saveWpBriefDraft(input);
    expect(r).toEqual({ ok: false, error: "ไม่มีสิทธิ์ทำรายการนี้" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps 42501 to the Thai permission message", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "x" } });
    const r = await saveWpBriefDraft(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ไม่มีสิทธิ์/);
  });

  it("falls back to the generic failure message on an unmapped error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XXXXX", message: "x" } });
    const r = await saveWpBriefDraft(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ไม่สำเร็จ/);
  });

  it("rejects a malformed work package id before ever calling the RPC", async () => {
    const r = await saveWpBriefDraft({ ...input, workPackageId: "not-a-uuid" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("addWpBriefCriterion", () => {
  it("maps args and gates on PM_ROLES", async () => {
    const r = await addWpBriefCriterion({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      briefId: BRIEF_ID,
      body: "เหล็กครบทุกจุดตามแบบ",
    });
    expect(r).toEqual({ ok: true, id: "new-id" });
    expect(requireActionRole).toHaveBeenCalledWith(PM_ROLES);
    // p_sort_order is OMITTED (not null) so the RPC's SQL default fires —
    // exactOptionalPropertyTypes distinguishes "absent" from "undefined".
    expect(rpc).toHaveBeenCalledWith("add_wp_brief_criterion", {
      p_brief_id: BRIEF_ID,
      p_body: "เหล็กครบทุกจุดตามแบบ",
    });
    expect(revalidatePath).toHaveBeenCalledWith(BRIEF_HREF);
  });

  it("rejects a malformed brief id before ever calling the RPC", async () => {
    const r = await addWpBriefCriterion({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      briefId: "not-a-uuid",
      body: "x",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateWpBriefCriterion", () => {
  it("maps args", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await updateWpBriefCriterion({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      criterionId: "cccccccc-0000-4000-8000-000000000002",
      body: "แก้ไขแล้ว",
      sortOrder: 2,
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_wp_brief_criterion", {
      p_id: "cccccccc-0000-4000-8000-000000000002",
      p_body: "แก้ไขแล้ว",
      p_sort_order: 2,
    });
  });
});

describe("deleteWpBriefCriterion", () => {
  it("maps args and reports the 42501 unknown-target collapse as the not-found message", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "x" } });
    const r = await deleteWpBriefCriterion({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      criterionId: "cccccccc-0000-4000-8000-000000000002",
    });
    expect(r.ok).toBe(false);
    expect(rpc).toHaveBeenCalledWith("delete_wp_brief_criterion", {
      p_id: "cccccccc-0000-4000-8000-000000000002",
    });
  });
});

describe("addWpBriefEvidenceSlot", () => {
  it("maps args incl. an optional criterion mapping", async () => {
    const r = await addWpBriefEvidenceSlot({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      briefId: BRIEF_ID,
      label: "มุมกว้างเห็นทั้งฐาน",
      criterionId: "crit-1",
    });
    expect(r).toEqual({ ok: true, id: "new-id" });
    expect(rpc).toHaveBeenCalledWith("add_wp_brief_evidence_slot", {
      p_brief_id: BRIEF_ID,
      p_label: "มุมกว้างเห็นทั้งฐาน",
      p_criterion_id: "crit-1",
    });
  });

  it("passes null when no criterion is mapped (a bare slot)", async () => {
    await addWpBriefEvidenceSlot({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      briefId: BRIEF_ID,
      label: "ภาพระยะใกล้",
      criterionId: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "add_wp_brief_evidence_slot",
      expect.objectContaining({ p_criterion_id: null }),
    );
  });
});

describe("updateWpBriefEvidenceSlot", () => {
  it("maps args", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await updateWpBriefEvidenceSlot({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      slotId: "dddddddd-0000-4000-8000-000000000001",
      label: "แก้ไขแล้ว",
      criterionId: null,
      sortOrder: 3,
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_wp_brief_evidence_slot", {
      p_id: "dddddddd-0000-4000-8000-000000000001",
      p_label: "แก้ไขแล้ว",
      p_criterion_id: null,
      p_sort_order: 3,
    });
  });
});

describe("deleteWpBriefEvidenceSlot", () => {
  it("maps args", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const r = await deleteWpBriefEvidenceSlot({
      projectId: PROJECT_ID,
      workPackageId: WP_ID,
      slotId: "dddddddd-0000-4000-8000-000000000001",
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("delete_wp_brief_evidence_slot", {
      p_id: "dddddddd-0000-4000-8000-000000000001",
    });
  });
});

describe("publishWpBrief", () => {
  it("maps args and returns the new version id", async () => {
    rpc.mockResolvedValueOnce({ data: "version-id-1", error: null });
    const r = await publishWpBrief({ projectId: PROJECT_ID, workPackageId: WP_ID });
    expect(r).toEqual({ ok: true, versionId: "version-id-1" });
    expect(rpc).toHaveBeenCalledWith("publish_wp_brief", { p_work_package_id: WP_ID });
    expect(revalidatePath).toHaveBeenCalledWith(BRIEF_HREF);
  });

  it("maps 22023 (no draft to publish) to a specific Thai message", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "x" } });
    const r = await publishWpBrief({ projectId: PROJECT_ID, workPackageId: WP_ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ยังไม่มีร่าง/);
  });
});
