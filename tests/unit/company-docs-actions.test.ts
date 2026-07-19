// Writing failing test first.
//
// Spec 329 U2 — company-document server actions: metadata INSERTs on
// requireActionRole(ACCOUNTING_ROLES).auth.supabase (table RLS gates again
// server-side; supersede-pattern INSERTs only, never UPDATE), and the share
// link mints a 7-day signed URL on the ADMIN client behind a
// COMPANY_DOC_VIEW_ROLES gate. Gate + clients mocked: pins wiring + arg
// mapping (gate short-circuits before any write), not the DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, insert, createSignedUrl } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  insert: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
  NOT_PERMITTED: "ไม่มีสิทธิ์ทำรายการนี้",
}));
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import {
  addCompanyDocument,
  addCompanyDocumentVersion,
  retireCompanyDocument,
  mintCompanyDocShareLink,
} from "@/lib/company-docs/actions";
import { ACCOUNTING_ROLES, COMPANY_DOC_VIEW_ROLES } from "@/lib/auth/role-home";

const docInput = {
  id: "d-1",
  title: "หนังสือรับรองบริษัท",
  note: null,
  issuedAt: "2026-02-12",
  expiresAt: "2026-08-12",
  storagePath: "d-1/cert.pdf",
};

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: {
      supabase: { from: () => ({ insert }) },
      user: { id: "acc-1" },
    },
  });
  insert.mockReset().mockResolvedValue({ error: null });
  createSignedUrl.mockReset().mockResolvedValue({
    data: { signedUrl: "https://signed/doc" },
    error: null,
  });
});

describe("addCompanyDocument", () => {
  it("inserts the row with created_by from the session", async () => {
    const r = await addCompanyDocument(docInput);
    expect(r).toEqual({ ok: true });
    expect(requireActionRole).toHaveBeenCalledWith(ACCOUNTING_ROLES);
    expect(insert).toHaveBeenCalledWith({
      id: "d-1",
      title: "หนังสือรับรองบริษัท",
      note: null,
      issued_at: "2026-02-12",
      expires_at: "2026-08-12",
      storage_path: "d-1/cert.pdf",
      superseded_by: null,
      created_by: "acc-1",
    });
  });
  it("gate short-circuits before the insert", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await addCompanyDocument(docInput);
    expect(r.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("addCompanyDocumentVersion", () => {
  it("sets superseded_by to the replaced row", async () => {
    const r = await addCompanyDocumentVersion({ ...docInput, supersedes: "d-0" });
    expect(r).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ superseded_by: "d-0" }));
  });
});

describe("retireCompanyDocument", () => {
  it("inserts an all-payload-NULL tombstone pointing at the head", async () => {
    const r = await retireCompanyDocument({ headId: "d-1" });
    expect(r).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({
      superseded_by: "d-1",
      created_by: "acc-1",
    });
  });
  it("gates on ACCOUNTING_ROLES", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await retireCompanyDocument({ headId: "d-1" });
    expect(r.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("mintCompanyDocShareLink", () => {
  it("mints a 7-day signed URL for VIEW roles (not accounting-only)", async () => {
    const r = await mintCompanyDocShareLink({ storagePath: "d-1/cert.pdf" });
    expect(r).toEqual({ ok: true, url: "https://signed/doc" });
    expect(requireActionRole).toHaveBeenCalledWith(COMPANY_DOC_VIEW_ROLES);
    expect(createSignedUrl).toHaveBeenCalledWith("d-1/cert.pdf", 604800);
  });
  it("gate short-circuits before minting", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await mintCompanyDocShareLink({ storagePath: "d-1/cert.pdf" });
    expect(r.ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
