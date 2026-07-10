// Back-nav sweep 2026-07-11: the contact detail's back chip used a hardcoded
// "/contacts" (a redirect stub → /contacts/customers), so 3 of 4 contact types
// backed out to the WRONG list. contactListPath(type) is the one mapping from
// a detail-route type segment to the list page that owns it — used as the
// safeBackHref fallback on the detail AND as the withBackFrom source on the
// list rows.

import { describe, expect, it } from "vitest";
import { contactListPath } from "@/lib/contacts/list-path";

describe("contactListPath", () => {
  it("maps each contact type to the list page that owns it", () => {
    expect(contactListPath("clients")).toBe("/contacts/customers");
    expect(contactListPath("suppliers")).toBe("/contacts/vendors");
    expect(contactListPath("service-providers")).toBe("/contacts/vendors");
    expect(contactListPath("contractors")).toBe("/contacts/subcontractors");
  });
});
