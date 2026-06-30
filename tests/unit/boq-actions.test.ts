// Writing failing test first.
//
// Spec 237 (ADR 0066 / S10-U2) — the BOQ template/line server actions. Each does
// a friendly early role check via requireRole(BACK_OFFICE_ROLES) (defense-in-depth;
// the SECURITY DEFINER RPC gates again) and relays through the RLS session client
// to the spec-236 RPCs. The tests pin: a non-allowed role is bounced before any
// RPC, and an allowed role calls the RPC with the exact arg shape (optional
// uuid/text args OMITTED when empty, per exactOptionalPropertyTypes).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, rpc } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addBoqLine,
  createBoqTemplate,
  removeBoqLine,
  setBoqTemplateActive,
  updateBoqLine,
  updateBoqTemplate,
} from "@/app/catalog/boq-templates/actions";

const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const LINE = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const WORKCAT = "44444444-4444-4444-8444-444444444444";

// requireRole's not-allowed branch redirects (throws); model that as a throw so a
// bounced action never reaches the RPC.
function denyRole() {
  requireRole.mockImplementation(() => {
    throw new Error("__redirect__");
  });
}

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: "u1", role: "procurement", fullName: null });
  rpc.mockReset().mockResolvedValue({ data: TEMPLATE, error: null });
});

describe("createBoqTemplate (spec 237)", () => {
  it("bounces a non-allowed role before any RPC", async () => {
    denyRole();
    await expect(
      createBoqTemplate({ code: "BOQ-1", name: "บ้านมาตรฐาน", description: "" }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_boq_template and OMITS p_description when empty", async () => {
    const r = await createBoqTemplate({ code: "BOQ-1", name: "บ้านมาตรฐาน", description: "" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("create_boq_template", {
      p_code: "BOQ-1",
      p_name: "บ้านมาตรฐาน",
    });
  });

  it("includes p_description when provided", async () => {
    await createBoqTemplate({ code: "BOQ-1", name: "บ้านมาตรฐาน", description: "หมายเหตุ" });
    expect(rpc).toHaveBeenCalledWith("create_boq_template", {
      p_code: "BOQ-1",
      p_name: "บ้านมาตรฐาน",
      p_description: "หมายเหตุ",
    });
  });

  it("maps a 23505 duplicate code to a friendly error", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "boq_template_code_key" },
    });
    const r = await createBoqTemplate({ code: "BOQ-1", name: "x", description: "" });
    expect(r.ok).toBe(false);
  });
});

describe("updateBoqTemplate / setBoqTemplateActive (spec 237)", () => {
  it("update relays p_id + p_name (omits empty description)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await updateBoqTemplate({ id: TEMPLATE, name: "ใหม่", description: "" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_boq_template", { p_id: TEMPLATE, p_name: "ใหม่" });
  });

  it("set-active relays p_id + p_is_active", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await setBoqTemplateActive({ id: TEMPLATE, isActive: false });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_boq_template_active", {
      p_id: TEMPLATE,
      p_is_active: false,
    });
  });

  it("set-active bounces a non-allowed role", async () => {
    denyRole();
    await expect(setBoqTemplateActive({ id: TEMPLATE, isActive: true })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("addBoqLine (spec 237)", () => {
  it("a free-text line omits the optional uuid/text args", async () => {
    rpc.mockResolvedValue({ data: LINE, error: null });
    const r = await addBoqLine({
      boqTemplateId: TEMPLATE,
      description: "งานเทพื้น",
      qty: 10,
      unit: "ตารางเมตร",
      catalogItemId: "",
      workCategoryId: "",
      materialRate: 250,
      laborRate: 120,
      isStandard: true,
      variationType: "standard",
      exclusivityGroup: "",
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("add_boq_line", {
      p_boq_template_id: TEMPLATE,
      p_description: "งานเทพื้น",
      p_qty: 10,
      p_unit: "ตารางเมตร",
      p_material_rate: 250,
      p_labor_rate: 120,
      p_is_standard: true,
      p_variation_type: "standard",
    });
  });

  it("includes the catalog item + work-cat + exclusivity when set", async () => {
    rpc.mockResolvedValue({ data: LINE, error: null });
    await addBoqLine({
      boqTemplateId: TEMPLATE,
      description: "เสาเข็ม",
      qty: 4,
      unit: "ต้น",
      catalogItemId: ITEM,
      workCategoryId: WORKCAT,
      materialRate: 0,
      laborRate: 0,
      isStandard: false,
      variationType: "provisional_sum",
      exclusivityGroup: "foundation",
    });
    expect(rpc).toHaveBeenCalledWith("add_boq_line", {
      p_boq_template_id: TEMPLATE,
      p_description: "เสาเข็ม",
      p_qty: 4,
      p_unit: "ต้น",
      p_material_rate: 0,
      p_labor_rate: 0,
      p_is_standard: false,
      p_variation_type: "provisional_sum",
      p_catalog_item_id: ITEM,
      p_work_category_id: WORKCAT,
      p_exclusivity_group: "foundation",
    });
  });

  it("rejects a blank description before the RPC", async () => {
    const r = await addBoqLine({
      boqTemplateId: TEMPLATE,
      description: "   ",
      qty: 1,
      unit: "ชิ้น",
      catalogItemId: "",
      workCategoryId: "",
      materialRate: 0,
      laborRate: 0,
      isStandard: false,
      variationType: "standard",
      exclusivityGroup: "",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-positive qty before the RPC", async () => {
    const r = await addBoqLine({
      boqTemplateId: TEMPLATE,
      description: "x",
      qty: 0,
      unit: "ชิ้น",
      catalogItemId: "",
      workCategoryId: "",
      materialRate: 0,
      laborRate: 0,
      isStandard: false,
      variationType: "standard",
      exclusivityGroup: "",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bounces a non-allowed role", async () => {
    denyRole();
    await expect(
      addBoqLine({
        boqTemplateId: TEMPLATE,
        description: "x",
        qty: 1,
        unit: "ชิ้น",
        catalogItemId: "",
        workCategoryId: "",
        materialRate: 0,
        laborRate: 0,
        isStandard: false,
        variationType: "standard",
        exclusivityGroup: "",
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateBoqLine / removeBoqLine (spec 237)", () => {
  it("update relays p_id + the line fields, omitting empty optionals", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await updateBoqLine({
      id: LINE,
      description: "แก้ไข",
      qty: 2,
      unit: "ชิ้น",
      catalogItemId: "",
      workCategoryId: "",
      materialRate: 5,
      laborRate: 5,
      isStandard: true,
      variationType: "added",
      exclusivityGroup: "",
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_boq_line", {
      p_id: LINE,
      p_description: "แก้ไข",
      p_qty: 2,
      p_unit: "ชิ้น",
      p_material_rate: 5,
      p_labor_rate: 5,
      p_is_standard: true,
      p_variation_type: "added",
    });
  });

  it("remove relays p_id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await removeBoqLine({ id: LINE });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("remove_boq_line", { p_id: LINE });
  });

  it("remove bounces a non-allowed role", async () => {
    denyRole();
    await expect(removeBoqLine({ id: LINE })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
