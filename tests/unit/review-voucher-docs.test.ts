// Spec 373 verify catch — the voucher's docs section was DEAD: mintSignedUrls
// returns a map keyed by row.id (every other caller agrees), but the voucher
// looked up urls.get(storage_path), so every doc filtered to "" and the page
// showed เอกสาร (0) for rows that HAVE receipts — the exact surface accounting
// validates documents on. This pins the map-key contract end-to-end.

import { describe, expect, it, vi } from "vitest";

const rpcEvent = {
  source_table: "office_expenses",
  source_id: "e1",
  project_id: null,
  project_name: null,
  amount: 500,
  event_date: "2026-07-01",
  counterparty: null,
  doc_count: 1,
  review_status: "pending",
  open_flag_count: 0,
  docs_expected: "expected",
};

function chain(result: unknown) {
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  for (const m of ["select", "eq", "order", "limit", "in"]) {
    builder[m] = () => builder;
  }
  return builder;
}

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ data: [rpcEvent], error: null }),
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: (table: string) =>
      chain(
        table === "office_expense_attachments"
          ? { data: [{ id: "att-1", storage_path: "e1/att-1.jpeg" }], error: null }
          : { data: [], error: null },
      ),
  }),
}));

// The seam under test: the real mintSignedUrls keys its map by row.id.
vi.mock("@/lib/storage/signed-urls", () => ({
  mintSignedUrls: async (_bucket: string, rows: { id: string }[]) =>
    new Map(rows.map((r) => [r.id, `https://signed.example/${r.id}`])),
}));

import { loadReviewVoucher } from "@/lib/accounting/load-review-voucher";

describe("spec 373 — voucher docs resolve against the id-keyed signed-url map", () => {
  it("a stored attachment surfaces as a signed doc link (not silently filtered)", async () => {
    const data = await loadReviewVoucher("office_expenses", "e1");
    expect(data).not.toBeNull();
    expect(data?.docs).toEqual([{ label: "ใบเสร็จ 1", url: "https://signed.example/att-1" }]);
  });
});
