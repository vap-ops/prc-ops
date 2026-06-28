// Spec 220 (G63) — the role-admin server action narrows the untrusted role
// string with isUserRole before relaying to set_user_role (the SECURITY DEFINER
// RPC re-gates + the enum-typed param is the real guard; this is the friendly
// early reject). Validate against USER_ROLE_LABEL — the role-label SSOT.

import { describe, it, expect } from "vitest";
import { isUserRole } from "@/lib/users/validate";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

describe("isUserRole", () => {
  it("accepts every real user_role (the USER_ROLE_LABEL keys)", () => {
    for (const role of Object.keys(USER_ROLE_LABEL)) {
      expect(isUserRole(role)).toBe(true);
    }
  });

  it("rejects unknown / malformed values", () => {
    expect(isUserRole("")).toBe(false);
    expect(isUserRole("bogus")).toBe(false);
    expect(isUserRole("Super_Admin")).toBe(false); // case-sensitive
    expect(isUserRole("administrator")).toBe(false);
    expect(isUserRole("toString")).toBe(false); // not fooled by prototype keys
  });
});
