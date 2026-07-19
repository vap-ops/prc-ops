// Writing failing test first.
//
// Spec 331 §5 — the super_admin registry actions. Each relays one DEFINER RPC
// keyed by the stable `code` (never the surrogate id) on the AUTHED session's
// client: the RPC gates the caller's role itself, and the admin client would
// arrive with a null role and 42501.

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

import {
  createDocumentCategory,
  createDocumentType,
  setDocumentTypeActive,
  updateDocumentType,
} from "@/lib/company-docs/registry-actions";

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: { supabase: { rpc }, user: { id: "super-1" } },
  });
  rpc.mockReset().mockResolvedValue({ error: null });
});

describe("registry actions", () => {
  it("creates a category through its RPC", async () => {
    const r = await createDocumentCategory({ code: "OPS", nameTh: "ปฏิบัติการ", sortOrder: 80 });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("create_company_document_category", {
      p_code: "OPS",
      p_name_th: "ปฏิบัติการ",
      p_name_en: null,
      p_sort_order: 80,
    });
  });

  it("creates a type with all four flags", async () => {
    await createDocumentType({
      categoryCode: "TAX",
      code: "TAX_NEW",
      nameTh: "ใหม่",
      hint: "คำอธิบาย",
      isSingleton: false,
      isRequired: true,
      requiresExpiry: true,
      sortOrder: 60,
    });
    expect(rpc).toHaveBeenCalledWith("create_company_document_type", {
      p_category_code: "TAX",
      p_code: "TAX_NEW",
      p_name_th: "ใหม่",
      p_name_en: null,
      p_hint: "คำอธิบาย",
      p_is_singleton: false,
      p_is_required: true,
      p_requires_expiry: true,
      p_sort_order: 60,
    });
  });

  it("updates a type by code, never by id", async () => {
    await updateDocumentType({
      code: "TAX_PP20",
      nameTh: "ภ.พ.20",
      hint: null,
      isSingleton: true,
      isRequired: true,
      requiresExpiry: false,
      sortOrder: 10,
    });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_code: "TAX_PP20" });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_id");
  });

  it("deactivates rather than deletes", async () => {
    await setDocumentTypeActive({ code: "TAX_PP01", isActive: false });
    expect(rpc).toHaveBeenCalledWith("set_company_document_type_active", {
      p_code: "TAX_PP01",
      p_is_active: false,
    });
  });

  it("surfaces the RPC's own Thai refusal instead of a generic message", async () => {
    rpc.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const r = await createDocumentType({
      categoryCode: "TAX",
      code: "TAX_PP20",
      nameTh: "ซ้ำ",
      hint: null,
      isSingleton: true,
      isRequired: false,
      requiresExpiry: false,
      sortOrder: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("รหัส");
  });

  it("gates every action on super_admin before touching the RPC", async () => {
    requireActionRole.mockResolvedValue({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    expect((await createDocumentCategory({ code: "X", nameTh: "x", sortOrder: 0 })).ok).toBe(false);
    expect((await setDocumentTypeActive({ code: "X", isActive: true })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
