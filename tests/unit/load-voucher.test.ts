// Spec 308 follow-up — the accounting voucher must surface the delivery-scoped
// receive paper. Before 308, the receive-moment ใบส่งของ/ใบเสร็จ landed as a PR
// attachment (purpose='invoice') and reached the voucher. 308 U2 moved it to
// purchase_order_attachments purpose='proof_of_delivery' (delivery-scoped), which
// the voucher never read → delivery-backed purchases reached the auditor with a
// blank source-doc slot. RED first: a delivery-backed PR's proof-of-delivery docs
// must appear in voucher.attachments; a delivery-less PR must NOT trigger the read.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/purchasing/attachment-signed-urls", () => ({
  mintSignedUrlsForAttachments: vi.fn(async () => new Map([["a1", "signed-a1"]])),
}));
vi.mock("@/lib/storage/signed-urls", () => ({
  mintSignedUrls: vi.fn(async () => new Map([["pf1", "signed-pf1"]])),
}));
vi.mock("@/lib/users/display-names", () => ({
  fetchDisplayNames: vi.fn(async () => new Map<string, string>()),
}));

import { loadPurchaseVoucher } from "@/lib/accounting/load-voucher";

const PR_INVOICE = [
  { id: "a1", kind: "image", purpose: "invoice", storage_path: "pr/a1", url: null },
];
const PROOF = [
  {
    id: "pf1",
    kind: "image",
    purpose: "proof_of_delivery",
    storage_path: "po/pf1",
    delivery_id: "del1",
  },
];

// A chainable fake matching the loader's admin reads. Keyed by table; the by-id
// header read (purchase_requests) resolves via SINGLE, the list reads via LIST.
// `delivery_id` on the header row is what a delivery-backed PR carries.
function makeClient(prRow: Record<string, unknown>) {
  const SINGLE: Record<string, unknown> = { purchase_requests: prRow };
  const LIST: Record<string, unknown[]> = {
    purchase_request_attachments_current: PR_INVOICE,
    purchase_order_attachments_current: PROOF,
    journal_entries: [],
  };
  function makeQuery(table: string) {
    const q: Record<string, unknown> = { __single: false };
    for (const m of ["select", "eq", "in", "order"]) q[m] = () => q;
    q.maybeSingle = () => {
      q.__single = true;
      return q;
    };
    q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({
        data: q.__single ? (SINGLE[table] ?? null) : (LIST[table] ?? []),
        error: null,
      }).then(resolve, reject);
    return q;
  }
  return { from: (table: string) => makeQuery(table) } as never;
}

const BASE_PR = {
  id: "pr1",
  supplier_id: null,
  supplier: "ผู้ขาย",
  amount: 100,
  vat_rate: 0,
  status: "delivered",
  purchased_at: null,
  requested_at: null,
  requested_by: null,
  approved_by: null,
  work_package_id: null,
  project_id: null,
  purchase_order_id: "po1",
};

describe("loadPurchaseVoucher — delivery proof (spec 308 follow-up)", () => {
  it("surfaces the delivery's proof-of-delivery paper alongside PR docs", async () => {
    const voucher = await loadPurchaseVoucher(
      makeClient({ ...BASE_PR, delivery_id: "del1" }),
      "pr1",
    );
    const proof = voucher.attachments.find((a) => a.purpose === "proof_of_delivery");
    expect(proof).toBeDefined();
    expect(proof?.id).toBe("pf1");
    expect(proof?.href).toBe("signed-pf1");
    // the existing PR invoice doc is still there — merge, not replace.
    expect(voucher.attachments.some((a) => a.purpose === "invoice")).toBe(true);
  });

  it("does not merge proof docs for a delivery-less PR", async () => {
    const voucher = await loadPurchaseVoucher(makeClient({ ...BASE_PR, delivery_id: null }), "pr1");
    expect(voucher.attachments.some((a) => a.purpose === "proof_of_delivery")).toBe(false);
    expect(voucher.attachments.some((a) => a.purpose === "invoice")).toBe(true);
  });
});
