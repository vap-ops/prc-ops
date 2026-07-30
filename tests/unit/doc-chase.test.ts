// Spec 380 U2 — the doc-chase SSOT: per-supplier-class accounting-doc
// requirements. Every surface (chase page, hub chip, row chips, U6 RPC fix)
// derives from THIS module; no local re-derivations (spec §6).
import { describe, expect, it } from "vitest";

import { Constants } from "@/lib/db/database.types";
import { DOC_CHASE_ASK_NON_VAT, DOC_CHASE_ASK_UNKNOWN, DOC_CHASE_ASK_VAT } from "@/lib/i18n/labels";
import {
  agingDays,
  chaseAsk,
  docCoverage,
  docRequirementClass,
  IN_SCOPE_STATUSES,
  LOOSE_PR_PURPOSES,
  NEVER_SATISFYING,
  SATISFYING_DOC_TYPES,
  type DocAttachment,
} from "@/lib/purchasing/doc-chase";

const ALL_DOC_TYPES = Constants.public.Enums.purchase_doc_type;

const att = (over: Partial<DocAttachment>): DocAttachment => ({
  docType: null,
  source: "pr",
  purpose: "invoice",
  ...over,
});

describe("docRequirementClass", () => {
  // is_vat_registered is NOT NULL in the DB — null supplier = no supplier row,
  // the only reachable unknown (spec §2 amendment).
  it("maps the full domain", () => {
    expect(docRequirementClass(null)).toBe("unknown");
    expect(docRequirementClass({ isVatRegistered: true })).toBe("vat");
    expect(docRequirementClass({ isVatRegistered: false })).toBe("non_vat");
  });
});

describe("doc-type partition", () => {
  it("every enum member is either satisfying-for-someone or never-satisfying — no orphan, no overlap", () => {
    const satisfying = new Set([...SATISFYING_DOC_TYPES.vat, ...SATISFYING_DOC_TYPES.non_vat]);
    for (const t of ALL_DOC_TYPES) {
      const inSat = satisfying.has(t);
      const inNever = (NEVER_SATISFYING as readonly string[]).includes(t);
      expect(inSat !== inNever, `${t} must be in exactly one set`).toBe(true);
    }
  });

  it("vat is satisfied ONLY by the full tax invoice; non_vat and unknown by the ladder", () => {
    expect(SATISFYING_DOC_TYPES.vat).toEqual(["tax_invoice_full"]);
    // both pinned against LITERALS — asserting unknown === non_vat would pass
    // for any wrong shared ladder (reviewer catch)
    const ladder = ["tax_invoice_full", "receipt_cash_bill", "payment_voucher", "cert_in_lieu"];
    expect([...SATISFYING_DOC_TYPES.non_vat]).toEqual(ladder);
    expect([...SATISFYING_DOC_TYPES.unknown]).toEqual(ladder);
  });
});

describe("docCoverage", () => {
  it("out of scope before money is spent or after cancellation", () => {
    // Derived complement over the LIVE enum — a 9th status value lands here
    // and fails loudly instead of silently reading as out_of_scope forever.
    const outOfScope = Constants.public.Enums.purchase_request_status.filter(
      (s) => !IN_SCOPE_STATUSES.includes(s),
    );
    expect(outOfScope.sort()).toEqual(
      ["approved", "cancelled", "on_route", "purchased", "rejected", "requested"].sort(),
    );
    for (const status of outOfScope) {
      expect(
        docCoverage({
          status,
          cls: "vat",
          attachments: [att({ docType: "tax_invoice_full" })],
          waived: false,
        }),
      ).toBe("out_of_scope");
    }
    expect(IN_SCOPE_STATUSES).toEqual(["delivered", "site_purchased"]);
  });

  it("typed satisfying doc covers per class; the wrong class's doc does not", () => {
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ docType: "tax_invoice_full" })],
        waived: false,
      }),
    ).toBe("covered_typed");
    // a cash bill does NOT discharge a VAT vendor's order (decision ① — the VAT gap)
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ docType: "receipt_cash_bill" })],
        waived: false,
      }),
    ).toBe("missing");
    expect(
      docCoverage({
        status: "delivered",
        cls: "non_vat",
        attachments: [att({ docType: "payment_voucher" })],
        waived: false,
      }),
    ).toBe("covered_typed");
  });

  it("supporting docs never satisfy, typed or not", () => {
    for (const docType of NEVER_SATISFYING) {
      expect(
        docCoverage({
          status: "delivered",
          cls: "unknown",
          attachments: [att({ docType })],
          waived: false,
        }),
      ).toBe("missing");
    }
  });

  it("legacy untyped rows cover loosely only via qualifying purposes", () => {
    expect(LOOSE_PR_PURPOSES).toEqual(["invoice", "payment"]);
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ purpose: "invoice" })],
        waived: false,
      }),
    ).toBe("covered_loose");
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ purpose: "payment" })],
        waived: false,
      }),
    ).toBe("covered_loose");
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ purpose: "quote" })],
        waived: false,
      }),
    ).toBe("missing");
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ source: "po", purpose: "source_document" })],
        waived: false,
      }),
    ).toBe("covered_loose");
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ source: "po", purpose: "proof_of_delivery" })],
        waived: false,
      }),
    ).toBe("missing");
  });

  it("waiver wins over missing but never over real coverage", () => {
    expect(docCoverage({ status: "delivered", cls: "vat", attachments: [], waived: true })).toBe(
      "waived",
    );
    expect(
      docCoverage({
        status: "delivered",
        cls: "vat",
        attachments: [att({ docType: "tax_invoice_full" })],
        waived: true,
      }),
    ).toBe("covered_typed");
    expect(docCoverage({ status: "delivered", cls: "vat", attachments: [], waived: false })).toBe(
      "missing",
    );
  });
});

describe("chaseAsk", () => {
  it("names the per-class ask from the label SSOT", () => {
    expect(chaseAsk("vat")).toBe(DOC_CHASE_ASK_VAT);
    expect(chaseAsk("non_vat")).toBe(DOC_CHASE_ASK_NON_VAT);
    expect(chaseAsk("unknown")).toBe(DOC_CHASE_ASK_UNKNOWN);
  });
});

describe("agingDays", () => {
  // Real production encodings: PostgREST emits +00:00, JS toISOString emits Z.
  // Instants, not strings (the spec-375 boundary lesson).
  const now = Date.parse("2026-07-30T05:00:00Z");

  it("counts whole days since delivered_at across encodings", () => {
    expect(agingDays(now, "2026-07-15T05:00:00+00:00", null, "2026-07-01T00:00:00+00:00")).toBe(15);
    expect(agingDays(now, "2026-07-29T06:00:00+00:00", null, "2026-07-01T00:00:00+00:00")).toBe(0);
  });

  it("falls back delivered_at → purchased_at → created_at", () => {
    expect(agingDays(now, null, "2026-07-20T05:00:00+00:00", "2026-07-01T00:00:00+00:00")).toBe(10);
    expect(agingDays(now, null, null, "2026-07-01T05:00:00+00:00")).toBe(29);
  });

  it("an unparseable anchor reads as fresh, never NaN-vanishing from bands", () => {
    expect(agingDays(now, "not-a-date", null, "2026-07-01T00:00:00+00:00")).toBe(0);
  });
});
