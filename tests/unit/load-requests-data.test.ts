// Writing failing test first.
//
// Perf (RUM-aimed TTFB, 2026-07-10): /requests ran ~15 serial DB round-trips —
// most of them independent reads left un-batched. loadRequestsData extracts the
// page's data layer so the independent reads fire in ONE Promise.all wave while
// the two genuine dependency chains (itemLinks→catalog_items; the PO facts pair)
// stay serial. This test PINS the assembled output byte-identical to the old
// inline logic (the concurrency itself is a structural change, verified in review
// + the live TTFB). The helper modules (display names, category vendors, catalog
// categories) and the admin client are mocked; the real aggregation helpers
// (sumOutstanding, buildPoDetailView, procurementBand) run for real.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchDisplayNames, loadCategoryVendors, loadCatalogCategories, createAdmin } = vi.hoisted(
  () => ({
    fetchDisplayNames: vi.fn(),
    loadCategoryVendors: vi.fn(),
    loadCatalogCategories: vi.fn(),
    createAdmin: vi.fn(),
  }),
);

vi.mock("@/lib/users/display-names", () => ({ fetchDisplayNames }));
vi.mock("@/lib/purchasing/load-category-vendors", () => ({ loadCategoryVendors }));
vi.mock(import("@/lib/catalog/categories"), async (importOriginal) => {
  // Partial mock: the read helper is stubbed; the pure helpers (categoryNameById,
  // membershipsByItem — needed by the spec-301 U2 verdict) run for real.
  const actual = await importOriginal();
  return { ...actual, loadCatalogCategories };
});
vi.mock("@/lib/db/admin", () => ({ createClient: createAdmin }));

import { loadRequestsData } from "@/lib/purchasing/load-requests-data";
import { buildPoDetailView } from "@/lib/purchasing/po-detail";

type Row = Record<string, unknown>;

// A keyed fake PostgREST client: each `.from(table).select(cols)...` chain
// resolves to fixtures[`${table}|${cols}`]. Filters (.in/.eq/.neq/.order/.limit)
// are no-ops — the fixture is pre-scoped to what that read should return.
type FakeCall = { table: string; method: string; args: unknown[] };
function fakeClient(fixtures: Record<string, Row[]>) {
  const calls: FakeCall[] = [];
  const from = (table: string) => {
    let cols = "";
    const b: Record<string, unknown> = {
      select: (...a: unknown[]) => {
        cols = String(a[0] ?? "");
        calls.push({ table, method: "select", args: a });
        return b;
      },
      eq: (...a: unknown[]) => (calls.push({ table, method: "eq", args: a }), b),
      neq: (...a: unknown[]) => (calls.push({ table, method: "neq", args: a }), b),
      in: (...a: unknown[]) => (calls.push({ table, method: "in", args: a }), b),
      not: (...a: unknown[]) => (calls.push({ table, method: "not", args: a }), b),
      order: (...a: unknown[]) => (calls.push({ table, method: "order", args: a }), b),
      limit: (...a: unknown[]) => (calls.push({ table, method: "limit", args: a }), b),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: fixtures[`${table}|${cols}`] ?? [], error: null }),
    };
    return b;
  };
  return { from, calls };
}

// Four PRs: pr1 in-transit (on_route, PO po1), pr2 delivered (WP-less), pr3
// to_order (PO po1), pr4 a MODERN store-bound PR (spec 301 U2a: work_package_id
// null by ADR 0065, provenance carried in requested_from_work_package_id).
const MY_REQUESTS = [
  {
    id: "pr1",
    requested_by: "u1",
    work_package_id: "wp1",
    requested_from_work_package_id: null,
    project_id: "proj1",
    purchase_order_id: "po1",
    status: "on_route",
  },
  {
    id: "pr2",
    requested_by: "u2",
    work_package_id: null,
    requested_from_work_package_id: null,
    project_id: "proj1",
    purchase_order_id: null,
    status: "delivered",
  },
  {
    id: "pr3",
    requested_by: null,
    work_package_id: "wp1",
    requested_from_work_package_id: null,
    project_id: "proj2",
    purchase_order_id: "po1",
    status: "approved",
  },
  {
    id: "pr4",
    requested_by: "u1",
    work_package_id: null,
    requested_from_work_package_id: "wp2",
    project_id: "proj1",
    purchase_order_id: null,
    status: "requested",
  },
] as const;

const USER_FIXTURES: Record<string, Row[]> = {
  // Spec 301 U1: the WP read carries category_id so the letter-code reconcile
  // (project_categories → work_categories.code) can run beside it.
  "work_packages|id, code, name, project_id, category_id": [
    { id: "wp1", code: "WP-1", name: "Foundation", project_id: "proj1", category_id: "pc1" },
    { id: "wp2", code: "WP-2", name: "Wiring", project_id: "proj1", category_id: "pc2" },
  ],
  "projects|id, name": [
    { id: "proj1", name: "Alpha" },
    { id: "proj2", name: "Beta" },
  ],
  "purchase_requests|id, catalog_item_id": [
    { id: "pr1", catalog_item_id: "item1" },
    { id: "pr2", catalog_item_id: null },
    { id: "pr3", catalog_item_id: "item1" },
    { id: "pr4", catalog_item_id: "item1" },
  ],
  "catalog_items|id, category_id": [{ id: "item1", category_id: "cat1" }],
  "purchase_orders|id, po_number, supplier, eta": [
    { id: "po1", po_number: 5001, supplier: "SupCo", eta: "2026-07-15" },
  ],
  "purchase_requests|id, status, purchase_order_id": [
    { id: "pr1", status: "on_route", purchase_order_id: "po1" },
    { id: "pr3", status: "approved", purchase_order_id: "po1" },
  ],
  "purchase_orders|id, po_number": [{ id: "po1", po_number: 5001 }],
  "suppliers|id, name, phone, is_vat_registered": [
    { id: "s1", name: "SupCo", phone: "02", is_vat_registered: true },
  ],
  "purchase_request_attachments_current|purchase_request_id": [
    { purchase_request_id: "pr1" },
    { purchase_request_id: "pr1" },
    { purchase_request_id: "pr3" },
  ],
};

const ADMIN_FIXTURES: Record<string, Row[]> = {
  "purchase_requests|id, amount": [
    { id: "pr1", amount: 100 },
    { id: "pr2", amount: 250 },
    { id: "pr3", amount: 50 },
  ],
  // Spec 301 U1: the letter-code reconcile reads project_categories via the
  // ADMIN client — its RLS is membership-gated (can_see_project) and returns
  // false for procurement roles, who are exactly this page's audience. The
  // resolved W0x code is non-sensitive display metadata (ADR 0026 pattern).
  "project_categories|id, work_categories(code)": [
    { id: "pc1", work_categories: { code: "W05" } },
    { id: "pc2", work_categories: { code: "W03" } },
  ],
  // Spec 301 U2: the off-category verdict's work-category hop (admin, same RLS wall).
  "project_categories|id, work_category_id": [
    { id: "pc1", work_category_id: "wc1" },
    { id: "pc2", work_category_id: "wc1" },
  ],
};

// Spec 301 U2: Relation R scopes wc1 to catX only → item1 (cat1) is OFF-scope.
USER_FIXTURES["work_category_material_categories|category_id, kind_filter"] = [
  { category_id: "catX", kind_filter: null },
];
USER_FIXTURES["catalog_item_categories|catalog_item_id, category_id"] = [];

beforeEach(() => {
  vi.clearAllMocks();
  fetchDisplayNames.mockResolvedValue(
    new Map([
      ["u1", "Alice"],
      ["u2", "Bob"],
    ]),
  );
  loadCategoryVendors.mockResolvedValue({ cat1: ["s1"] });
  loadCatalogCategories.mockResolvedValue([{ id: "cat1", code: "C1", name: "Cement" }]);
  createAdmin.mockReturnValue(fakeClient(ADMIN_FIXTURES) as never);
});

describe("loadRequestsData — procurement", () => {
  async function run() {
    return loadRequestsData({
      supabase: fakeClient(USER_FIXTURES) as never,
      myRequests: MY_REQUESTS as never,
      isProcurement: true,
      inTransitPoIds: ["po1"],
    });
  }

  it("resolves requester names + WP labels (the always-on reads)", async () => {
    const d = await run();
    expect(d.requesterNames.get("u1")).toBe("Alice");
    expect(d.requesterNames.get("u2")).toBe("Bob");
    expect(d.wpById.get("wp1")).toMatchObject({ code: "WP-1", name: "Foundation" });
  });

  it("reconciles each WP's category to its work-category code (spec 301 U1)", async () => {
    const d = await run();
    expect(d.wpById.get("wp1")?.categoryCode).toBe("W05");
  });

  it("derives the off-category verdict per PR (spec 301 U2 — picker semantics)", async () => {
    const d = await run();
    // pr1/pr3 buy item1 (cat1); wp1's work-category scope = [catX] → mismatch.
    expect(d.categoryMatchById.get("pr1")).toBe("mismatch");
    expect(d.categoryMatchById.get("pr3")).toBe("mismatch");
    // pr2 is a free-text, WP-less PR → no verdict.
    expect(d.categoryMatchById.get("pr2")).toBeNull();
  });

  it("anchors a MODERN store-bound PR on its provenance WP (spec 301 U2a)", async () => {
    const d = await run();
    // wp2 is referenced ONLY via requested_from_work_package_id — the WP read
    // must union both id sources so the display + verdict can resolve it.
    expect(d.wpById.get("wp2")).toMatchObject({ code: "WP-2", categoryCode: "W03" });
    // pr4: item1 (cat1) vs wp2 → wc1 scope [catX] → mismatch via provenance.
    expect(d.categoryMatchById.get("pr4")).toBe("mismatch");
  });

  it("runs the letter-code reconcile on the ADMIN client (project_categories RLS walls procurement)", async () => {
    const client = fakeClient(USER_FIXTURES);
    const admin = fakeClient(ADMIN_FIXTURES);
    createAdmin.mockReturnValue(admin as never);
    const d = await loadRequestsData({
      supabase: client as never,
      myRequests: MY_REQUESTS as never,
      isProcurement: true,
      inTransitPoIds: ["po1"],
    });
    expect(d.wpById.get("wp1")?.categoryCode).toBe("W05");
    expect(admin.calls).toContainEqual({
      table: "project_categories",
      method: "in",
      args: ["id", ["pc1", "pc2"]],
    });
    expect(client.calls.some((c) => c.table === "project_categories")).toBe(false);
  });

  it("resolves project names for the procurement filter", async () => {
    const d = await run();
    expect(d.projectNameById.get("proj1")).toBe("Alpha");
    expect(d.projectNameById.get("proj2")).toBe("Beta");
  });

  it("reads amounts (admin) and derives outstanding + delivered spend", async () => {
    const d = await run();
    expect(d.amountById.get("pr1")).toBe(100);
    expect(d.amountById.get("pr2")).toBe(250);
    expect(d.amountById.get("pr3")).toBe(50);
    // outstanding = in-transit rows only (pr1 on_route); delivered = pr2.
    expect(d.outstanding).toBe(100);
    expect(d.deliveredSpend).toBe(250);
  });

  it("resolves each PR's managed category (itemLinks → catalog_items → name)", async () => {
    const d = await run();
    expect(d.prCategory.get("pr1")).toEqual({ id: "cat1", name: "Cement" });
    // catalog_item_id null → uncategorised.
    expect(d.prCategory.get("pr2")).toEqual({ id: null, name: null });
    expect(d.prCategory.get("pr3")).toEqual({ id: "cat1", name: "Cement" });
  });

  it("builds PO facts for the in-transit PO groups and PO numbers for every row", async () => {
    const d = await run();
    const expected = buildPoDetailView([
      { status: "on_route", amount: null },
      { status: "approved", amount: null },
    ]);
    expect(d.poFactsById.get("po1")).toEqual({
      poNumber: 5001,
      supplier: "SupCo",
      eta: "2026-07-15",
      status: expected.status,
      lineCount: expected.activeLineCount,
    });
    expect(d.poNumberById.get("po1")).toBe(5001);
  });

  it("maps suppliers, category vendors, and per-PR document counts", async () => {
    const d = await run();
    expect(d.supplierRecords).toEqual([
      { id: "s1", name: "SupCo", phone: "02", isVatRegistered: true },
    ]);
    expect(d.categoryVendors).toEqual({ cat1: ["s1"] });
    expect(d.docCountById.get("pr1")).toBe(2);
    expect(d.docCountById.get("pr3")).toBe(1);
  });
});

describe("loadRequestsData — non-procurement", () => {
  it("resolves only the always-on reads; every procurement-only field is empty", async () => {
    const d = await loadRequestsData({
      supabase: fakeClient(USER_FIXTURES) as never,
      myRequests: MY_REQUESTS as never,
      isProcurement: false,
      inTransitPoIds: [],
    });
    // always-on (the letter-code reconcile is always-on too — spec 301 U1;
    // spec 311 U1: project names are always-on so the SITE worklist can label
    // and filter rows per project at 2+ concurrent actives)
    expect(d.requesterNames.get("u1")).toBe("Alice");
    expect(d.wpById.get("wp1")).toMatchObject({ code: "WP-1", categoryCode: "W05" });
    expect(d.projectNameById.get("proj1")).toBe("Alpha");
    expect(d.projectNameById.get("proj2")).toBe("Beta");
    // procurement-only — untouched
    expect(d.amountById.size).toBe(0);
    expect(d.outstanding).toBe(0);
    expect(d.deliveredSpend).toBe(0);
    expect(d.prCategory.size).toBe(0);
    expect(d.poFactsById.size).toBe(0);
    expect(d.poNumberById.size).toBe(0);
    expect(d.supplierRecords).toEqual([]);
    expect(d.categoryVendors).toEqual({});
    expect(d.docCountById.size).toBe(0);
    // the procurement-only helpers must not run. The admin client IS created for
    // the always-on letter-code reconcile (spec 301 U1) — the guard here is that
    // no admin MONEY read (purchase_requests amount) fires for non-procurement.
    expect(loadCategoryVendors).not.toHaveBeenCalled();
    const adminCalls = (createAdmin.mock.results ?? [])
      .flatMap((r) => (r.value as { calls?: FakeCall[] } | undefined)?.calls ?? [])
      .filter((c) => c.table === "purchase_requests");
    expect(adminCalls).toEqual([]);
  });
});

describe("loadRequestsData — read scoping (regression guards)", () => {
  it("excludes blacklisted suppliers and scopes the money read to the visible PR ids", async () => {
    const client = fakeClient(USER_FIXTURES);
    const admin = fakeClient(ADMIN_FIXTURES);
    createAdmin.mockReturnValue(admin as never);
    await loadRequestsData({
      supabase: client as never,
      myRequests: MY_REQUESTS as never,
      isProcurement: true,
      inTransitPoIds: ["po1"],
    });
    // Spec 280 P2b: a blacklisted supplier must never reach the create-PO picker.
    expect(client.calls).toContainEqual({
      table: "suppliers",
      method: "neq",
      args: ["contact_status", "blacklisted"],
    });
    // Money (amount) read is scoped to the visible PR ids via the admin client.
    expect(admin.calls).toContainEqual({
      table: "purchase_requests",
      method: "in",
      args: ["id", ["pr1", "pr2", "pr3", "pr4"]],
    });
  });
});
