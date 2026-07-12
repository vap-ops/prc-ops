// Spec 147 U3 — the request-detail loader batches its independent queries.
// RED first: asserts the fan runs CONCURRENTLY (max in-flight >= 5; a serial
// waterfall would peak at 1) and assembles the right shape. Helper modules
// (display names, signed-URL minting) are stubbed so the test isolates the
// loader's orchestration.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/users/display-names", () => ({
  fetchDisplayNames: vi.fn(async () => new Map<string, string>([["u1", "คุณขอ"]])),
}));
vi.mock("@/lib/purchasing/attachment-signed-urls", () => ({
  mintSignedUrlsForAttachments: vi.fn(async () => new Map<string, string>([["at1", "signed-at1"]])),
}));
vi.mock("@/lib/storage/signed-urls", () => ({
  mintSignedUrls: vi.fn(async () => new Map<string, string>([["pd1", "signed-pd1"]])),
}));
// Spec 301 U1: the letter-code reconcile runs on the ADMIN client (RLS walls
// procurement off project_categories). The admin fake serves that one read.
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({ from: (table: string) => makeQuery(table) }),
}));

import { loadRequestDetail } from "@/lib/purchasing/load-request-detail";

let inFlight = 0;
let maxInFlight = 0;

// Spec 301 U1/U2: the WP read carries category_id; the dependent tail resolves
// the whole category chain (loadWpCategoryScope on the ADMIN client) — the
// letter-code for the header AND the Relation-R scope for the off-category
// verdict on the PR's catalog item.
const WP = { id: "w1", code: "WP-01", name: "งาน", project_id: "p1", category_id: "pc1" };
const PROJECT_CATEGORY = {
  name: "งานประปา",
  work_category_id: "wc4",
  work_categories: { code: "W04" },
};
const CATALOG_ITEM = { id: "ci1", category_id: "catA" };
const RELATION_R = [{ category_id: "catA", kind_filter: null }];
const ATTACHMENTS = [
  {
    id: "at1",
    purchase_request_id: "pr1",
    kind: "image",
    purpose: "reference",
    storage_path: "path1",
    url: null,
    created_by: "u1",
    created_at: "2026-06-01",
  },
];
const PO = { po_number: 5 };
const PO_DOCS = [{ id: "pd1", kind: "pdf", storage_path: "po/path", created_at: "2026-06-02" }];
const SUPPLIERS = [{ id: "s1", name: "ผู้ขาย", phone: "08" }];

const SINGLE: Record<string, unknown> = {
  work_packages: WP,
  purchase_orders: PO,
  project_categories: PROJECT_CATEGORY,
  catalog_items: CATALOG_ITEM,
  // Spec 301f: the header shows which project the PR belongs to (procurement
  // spans projects; the WP line alone doesn't say).
  projects: { id: "p1", name: "โครงการอัลฟ่า" },
};
const LIST: Record<string, unknown[]> = {
  purchase_request_attachments_current: ATTACHMENTS,
  purchase_order_attachments_current: PO_DOCS,
  suppliers: SUPPLIERS,
  work_category_material_categories: RELATION_R,
  catalog_item_categories: [],
};

function makeQuery(table: string) {
  const q: Record<string, unknown> = { __single: false };
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
  q.maybeSingle = () => {
    q.__single = true;
    return q;
  };
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((r) => setTimeout(r, 5))
      .then(() => {
        inFlight--;
        return { data: q.__single ? SINGLE[table] : (LIST[table] ?? []), error: null };
      })
      .then(resolve, reject);
  };
  return q;
}

const supabase = { from: (table: string) => makeQuery(table) } as never;

const REQUEST = {
  id: "pr1",
  work_package_id: "w1",
  requested_from_work_package_id: null,
  requested_by: "u1",
  requested_by_email: "a@b.c",
  purchase_order_id: "po1",
  status: "approved",
  catalog_item_id: "ci1",
  project_id: "p1",
};

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("loadRequestDetail", () => {
  it("runs the independent fan concurrently (not a serial waterfall)", async () => {
    await loadRequestDetail(supabase, REQUEST as never, { isBackOffice: true });
    // wp + attachments + purchase_orders + po-docs + suppliers = 5 reads that
    // depend only on the request → must overlap. Serial would peak at 1.
    expect(maxInFlight).toBeGreaterThanOrEqual(5);
  });

  it("assembles the correct shape", async () => {
    const data = await loadRequestDetail(supabase, REQUEST as never, { isBackOffice: true });
    expect(data.wp?.code).toBe("WP-01");
    expect(data.wpCategoryCode).toBe("W04");
    // Spec 301 U2: catA (the item's canonical category) ∈ Relation-R scope → match.
    expect(data.categoryMatch).toBe("match");
    // Spec 301f: the PR's project name for the header line.
    expect(data.projectName).toBe("โครงการอัลฟ่า");
    expect(data.requesterName).toBe("คุณขอ");
    expect(data.attachments).toEqual(ATTACHMENTS);
    expect(data.attachmentUrls.get("at1")).toBe("signed-at1");
    expect(data.poRow?.po_number).toBe(5);
    expect(data.poDocs).toEqual(PO_DOCS);
    expect(data.poDocUrls.get("pd1")).toBe("signed-pd1");
    expect(data.suppliers).toEqual(SUPPLIERS);
  });

  it("falls back to email then em-dash for the requester name", async () => {
    const noName = await loadRequestDetail(
      supabase,
      { ...REQUEST, requested_by: "other" } as never,
      { isBackOffice: true },
    );
    expect(noName.requesterName).toBe("a@b.c");
  });

  it("skips suppliers unless back-office + approved", async () => {
    const data = await loadRequestDetail(supabase, REQUEST as never, { isBackOffice: false });
    expect(data.suppliers).toEqual([]);
  });

  it("returns poRow=null and no po-docs when the request has no PO", async () => {
    const data = await loadRequestDetail(
      supabase,
      { ...REQUEST, purchase_order_id: null } as never,
      { isBackOffice: true },
    );
    expect(data.poRow).toBeNull();
    expect(data.poDocs).toEqual([]);
  });

  it("returns categoryMatch=null for a free-text PR (no catalog item)", async () => {
    const data = await loadRequestDetail(supabase, { ...REQUEST, catalog_item_id: null } as never, {
      isBackOffice: true,
    });
    expect(data.categoryMatch).toBeNull();
    // the letter-code chain still resolves (header render is independent).
    expect(data.wpCategoryCode).toBe("W04");
  });

  it("returns categoryMatch=null for a WP-less PR (no scope)", async () => {
    const data = await loadRequestDetail(supabase, { ...REQUEST, work_package_id: null } as never, {
      isBackOffice: true,
    });
    expect(data.categoryMatch).toBeNull();
    expect(data.wpCategoryCode).toBeNull();
  });

  it("anchors a modern store-bound PR on its provenance WP (spec 301 U2a)", async () => {
    const data = await loadRequestDetail(
      supabase,
      { ...REQUEST, work_package_id: null, requested_from_work_package_id: "w1" } as never,
      { isBackOffice: true },
    );
    expect(data.wp?.code).toBe("WP-01");
    expect(data.wpCategoryCode).toBe("W04");
    expect(data.categoryMatch).toBe("match");
  });
});
