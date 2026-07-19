import { describe, expect, it } from "vitest";
import { expiryStatus } from "@/lib/company-docs/expiry";
import { groupDocuments } from "@/lib/company-docs/group-documents";
import type { Tables } from "@/lib/db/database.types";

type Row = Tables<"company_documents">;
const base = (over: Partial<Row>): Row => ({
  id: "a",
  title: "t",
  note: null,
  storage_path: "a/f.pdf",
  issued_at: null,
  expires_at: null,
  superseded_by: null,
  created_by: "u",
  created_at: "2026-07-01T00:00:00Z",
  // Spec 331 columns — the identity + multi-instance label.
  type_id: null,
  label: null,
  ...over,
});
const today = new Date("2026-07-19T00:00:00Z");

describe("expiryStatus", () => {
  it("none without a date", () => expect(expiryStatus(null, today)).toBe("none"));
  it("expired when past", () => expect(expiryStatus("2026-06-15", today)).toBe("expired"));
  it("expiring within 30 days", () => expect(expiryStatus("2026-08-10", today)).toBe("expiring"));
  it("ok beyond 30 days", () => expect(expiryStatus("2026-12-12", today)).toBe("ok"));
  it("expiring on the boundary day 30", () =>
    expect(expiryStatus("2026-08-18", today)).toBe("expiring"));
});

describe("groupDocuments", () => {
  it("A<-B<-C chain yields head C with history [B, A]", () => {
    const rows = [
      base({ id: "A" }),
      base({ id: "B", superseded_by: "A", storage_path: "B/f.pdf" }),
      base({ id: "C", superseded_by: "B", storage_path: "C/f.pdf" }),
    ];
    const docs = groupDocuments(rows);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.head.id).toBe("C");
    expect(docs[0]?.history.map((r) => r.id)).toEqual(["B", "A"]);
  });
  it("tombstone head hides the chain", () => {
    const rows = [
      base({ id: "A" }),
      base({ id: "T", superseded_by: "A", storage_path: null, title: null }),
    ];
    expect(groupDocuments(rows)).toHaveLength(0);
  });
  it("standalone doc has empty history", () => {
    expect(groupDocuments([base({ id: "A" })])[0]?.history).toEqual([]);
  });
  it("revived chain (content over tombstone) keeps content history, skips the tombstone row", () => {
    const rows = [
      base({ id: "A" }),
      base({ id: "T", superseded_by: "A", storage_path: null, title: null }),
      base({ id: "R", superseded_by: "T", storage_path: "R/f.pdf" }),
    ];
    const docs = groupDocuments(rows);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.head.id).toBe("R");
    expect(docs[0]?.history.map((r) => r.id)).toEqual(["A"]);
  });
});
