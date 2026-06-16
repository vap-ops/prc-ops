// Spec 97: the canonical contact-document storage path. Pure helper shared by
// the client uploader (target) and the server action (which rebuilds it, never
// trusting the client). Path = {kind}/{contactId}/{attachmentId}.{ext}.

import { describe, expect, it } from "vitest";
import {
  buildContactDocPath,
  isContactDocKind,
  isContactDocPurpose,
  isContractorDocPurpose,
  CONTRACTOR_DOC_PURPOSES,
} from "@/lib/contacts/document-path";

const ID = "11111111-1111-1111-1111-111111111111";
const ATT = "22222222-2222-2222-2222-222222222222";

describe("buildContactDocPath", () => {
  it("builds {kind}/{id}/{attachmentId}.{ext}", () => {
    expect(buildContactDocPath("contractor", ID, ATT, "jpeg")).toBe(`contractor/${ID}/${ATT}.jpeg`);
    expect(buildContactDocPath("service_provider", ID, ATT, "png")).toBe(
      `service_provider/${ID}/${ATT}.png`,
    );
  });

  it("rejects a bad kind, non-uuid ids, or an unsupported ext", () => {
    // @ts-expect-error invalid kind
    expect(buildContactDocPath("client", ID, ATT, "jpeg")).toBeNull();
    expect(buildContactDocPath("contractor", "not-a-uuid", ATT, "jpeg")).toBeNull();
    expect(buildContactDocPath("contractor", ID, "nope", "jpeg")).toBeNull();
    // @ts-expect-error invalid ext
    expect(buildContactDocPath("contractor", ID, ATT, "gif")).toBeNull();
  });
});

describe("contact-doc guards", () => {
  it("isContactDocKind accepts the three paid kinds only", () => {
    expect(isContactDocKind("contractor")).toBe(true);
    expect(isContactDocKind("supplier")).toBe(true);
    expect(isContactDocKind("service_provider")).toBe(true);
    expect(isContactDocKind("client")).toBe(false);
  });

  it("isContactDocPurpose accepts id_card / bank_book only", () => {
    expect(isContactDocPurpose("id_card")).toBe(true);
    expect(isContactDocPurpose("bank_book")).toBe(true);
    expect(isContactDocPurpose("passport")).toBe(false);
  });

  // Spec 131 U3 — a contractor (DC) may also hold company papers (company_cert,
  // vat_cert) the PM uploads; suppliers / service providers keep the base set.
  it("isContractorDocPurpose is a superset: base docs + company papers", () => {
    expect(isContractorDocPurpose("id_card")).toBe(true);
    expect(isContractorDocPurpose("bank_book")).toBe(true);
    expect(isContractorDocPurpose("company_cert")).toBe(true);
    expect(isContractorDocPurpose("vat_cert")).toBe(true);
    expect(isContractorDocPurpose("contract")).toBe(false);
    expect(isContractorDocPurpose("passport")).toBe(false);
    expect(isContractorDocPurpose(null)).toBe(false);
  });

  it("CONTRACTOR_DOC_PURPOSES lists the four in upload order", () => {
    expect([...CONTRACTOR_DOC_PURPOSES]).toEqual([
      "id_card",
      "bank_book",
      "company_cert",
      "vat_cert",
    ]);
  });
});
