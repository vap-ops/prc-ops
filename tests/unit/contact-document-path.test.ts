// Spec 97: the canonical contact-document storage path. Pure helper shared by
// the client uploader (target) and the server action (which rebuilds it, never
// trusting the client). Path = {kind}/{contactId}/{attachmentId}.{ext}.

import { describe, expect, it } from "vitest";
import {
  buildContactDocPath,
  isContactDocKind,
  isContactDocPurpose,
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
});
