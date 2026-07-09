// Writing failing test first.
//
// Spec 288 U1 — journal export route gate. The GL journal is money (spec 46): the
// export must admit ONLY the read-only ledger audience, ACCOUNTING_ROLES
// (accounting + super_admin), the same set the /accounting surfaces gate on. This
// is a source-scan pin, same style as payroll-export-gate.test.ts — it guards
// against the export being opened to a wider set than the ledger it dumps, and
// (since it reads money via the admin client) against the gate being dropped
// entirely.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";

const ROUTE = join(process.cwd(), "src", "app", "accounting", "journal", "export", "route.ts");
const route = () => readFileSync(ROUTE, "utf8");

describe("journal export gate (spec 288 U1)", () => {
  it("the export route gates on requireRole(ACCOUNTING_ROLES)", () => {
    expect(route()).toContain("requireRole(ACCOUNTING_ROLES)");
  });

  it("ACCOUNTING_ROLES is exactly accounting + super_admin (the ledger audience)", () => {
    expect([...ACCOUNTING_ROLES].sort()).toEqual(["accounting", "super_admin"]);
  });

  it("does not read the journal via the RLS-respecting server client (it is zero-grant)", () => {
    // Money tables have no authenticated SELECT — the read must go through the
    // admin client behind the gate, never @/lib/db/server.
    expect(route()).not.toContain('from "@/lib/db/server"');
    expect(route()).toContain("createAdminClient");
  });
});
