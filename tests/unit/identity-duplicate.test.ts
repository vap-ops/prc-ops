// Writing failing test first.
//
// Bug fix — approving a pending identity-change whose proposed national ID
// already belongs to another worker raises 23505 on `workers_tax_id_unique`.
// The fact must be named honestly, not the generic "ลองใหม่อีกครั้ง" transient
// copy (that RPC failure is permanent — the same proposal will always collide).

import { describe, expect, it } from "vitest";
import { identityDuplicateTaxIdFact } from "@/lib/profile/identity-duplicate";

describe("identityDuplicateTaxIdFact", () => {
  it("names the collision for a workers_tax_id_unique violation", () => {
    const fact = identityDuplicateTaxIdFact({
      code: "23505",
      message: 'duplicate key value violates unique constraint "workers_tax_id_unique"',
    });
    expect(fact).toContain("มีอยู่แล้ว");
  });

  it("returns null for a 23505 on an unrelated constraint", () => {
    expect(
      identityDuplicateTaxIdFact({
        code: "23505",
        message: 'duplicate key value violates unique constraint "some_other_key"',
      }),
    ).toBeNull();
  });

  it("returns null for a non-23505 error", () => {
    expect(identityDuplicateTaxIdFact({ code: "42501", message: "role not permitted" })).toBeNull();
  });

  it("returns null for no error", () => {
    expect(identityDuplicateTaxIdFact(null)).toBeNull();
  });
});
