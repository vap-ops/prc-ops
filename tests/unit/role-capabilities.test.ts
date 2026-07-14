// Spec 316 U1 — capability-registry coverage guards. The registry in
// src/lib/roles/role-capabilities.ts is the operator-facing SSOT for
// who-can-do-what; these guards make it impossible to add a *_ROLES set, a
// user_role enum value, or a roleHome() route without placing it there — the
// no-rot property the whole spec rests on.
import { describe, expect, it } from "vitest";

import * as roleHomeModule from "@/lib/auth/role-home";
import { roleHome } from "@/lib/auth/role-home";
import { BILLING_WRITE_ROLES } from "@/lib/accounting/billing-actions";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";
import {
  CAPABILITY_DOMAIN_LABEL,
  CAPABILITY_REGISTRY,
  HOME_LABEL,
  ROLE_CATEGORY,
  ROLE_CATEGORY_LABEL,
  ROLE_SUMMARY,
  capabilitiesForRole,
  isUnbuiltRole,
  rolesForCapability,
} from "@/lib/roles/role-capabilities";

// The enum universe, via the exhaustive USER_ROLE_LABEL Record (house pattern —
// see group-users-by-role.test.ts).
const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

// Mechanical sweep of role-home.ts: every exported array named *_ROLES.
const roleSetExports = Object.entries(roleHomeModule).filter(
  ([name, value]) => name.endsWith("_ROLES") && Array.isArray(value),
) as [string, readonly UserRole[]][];

describe("spec 316 — capability registry", () => {
  it("the export sweep itself works (sanity floor)", () => {
    expect(roleSetExports.length).toBeGreaterThanOrEqual(28);
  });

  it("every *_ROLES export in role-home.ts is a plain array (the sweep can't silently skip one)", () => {
    const named = Object.entries(roleHomeModule).filter(([name]) => name.endsWith("_ROLES"));
    expect(named.length).toBe(roleSetExports.length);
    for (const [name, value] of named) {
      expect(Array.isArray(value), `${name} must stay a plain array or the sweep goes blind`).toBe(
        true,
      );
    }
  });

  it("bijection: every swept export ↔ exactly one registry entry, by NAME and identity", () => {
    // Name-keyed (not just object identity) so an aliased export (e.g.
    // DOC_APPROVAL_ROLES = LEGAL_ROLES, one object, two names) still demands
    // its own entry, and deleting either entry fails (fresh-eyes finding).
    const swept = new Map<string, readonly UserRole[]>([
      ...roleSetExports,
      ["BILLING_WRITE_ROLES", BILLING_WRITE_ROLES],
    ]);
    for (const [name, value] of swept) {
      const entries = CAPABILITY_REGISTRY.filter((e) => e.setName === name);
      expect(entries, `${name} needs exactly one CAPABILITY_REGISTRY entry`).toHaveLength(1);
      // Identity, not equality: `roles` must BE the live export, never a copy.
      expect(entries[0]?.roles, `${name} entry must reference the live const`).toBe(value);
    }
    // Reverse: no entry may point at a set the sweep doesn't know (blocks a
    // hand-typed roles array smuggled in under a fake setName).
    for (const e of CAPABILITY_REGISTRY) {
      expect(swept.has(e.setName), `${e.key}: unknown setName ${e.setName}`).toBe(true);
    }
    expect(CAPABILITY_REGISTRY).toHaveLength(swept.size);
  });

  it("keys unique + kebab-case; visible labels nonblank", () => {
    const keys = CAPABILITY_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of CAPABILITY_REGISTRY) {
      expect(e.key, e.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      if (!e.hidden) expect(e.labelTh.trim().length, `${e.key} label`).toBeGreaterThan(0);
    }
  });

  it("ROLE_CATEGORY + ROLE_SUMMARY cover the whole enum exactly (a new enum value fails here)", () => {
    expect(Object.keys(ROLE_CATEGORY).sort()).toEqual([...ALL_ROLES].sort());
    expect(Object.keys(ROLE_SUMMARY).sort()).toEqual([...ALL_ROLES].sort());
    for (const role of ALL_ROLES) {
      expect(ROLE_SUMMARY[role].trim().length, `${role} summary`).toBeGreaterThan(0);
    }
  });

  it("exactly the three categories, each labeled and inhabited", () => {
    const used = new Set(Object.values(ROLE_CATEGORY));
    expect(used).toEqual(new Set(["office", "field", "external"]));
    for (const cat of used) {
      expect(ROLE_CATEGORY_LABEL[cat].trim().length, cat).toBeGreaterThan(0);
    }
  });

  it("HOME_LABEL covers roleHome() of every role (a new home route fails here)", () => {
    for (const role of ALL_ROLES) {
      const home = roleHome(role);
      expect(HOME_LABEL[home], `${role} home ${home} missing a Thai label`).toBeTruthy();
    }
  });

  it("isUnbuiltRole derives from roleHome, never a hand list", () => {
    for (const role of ALL_ROLES) {
      expect(isUnbuiltRole(role), role).toBe(roleHome(role) === "/coming-soon");
    }
    expect(isUnbuiltRole("site_owner")).toBe(true);
    expect(isUnbuiltRole("site_admin")).toBe(false);
    expect(isUnbuiltRole("legal")).toBe(false);
  });

  it("capabilitiesForRole: visible entries only, grouped in canonical domain order", () => {
    const caps = capabilitiesForRole("super_admin");
    expect(caps.some((e) => e.hidden === true)).toBe(false);
    const visible = CAPABILITY_REGISTRY.filter((e) => !e.hidden && e.roles.includes("super_admin"));
    expect(caps).toHaveLength(visible.length);
    // Arrives grouped: first occurrence of each domain follows the
    // CAPABILITY_DOMAIN_LABEL key order.
    const seen: string[] = [];
    for (const e of caps) if (!seen.includes(e.domain)) seen.push(e.domain);
    const canonical = Object.keys(CAPABILITY_DOMAIN_LABEL).filter((d) => seen.includes(d));
    expect(seen).toEqual(canonical);
  });

  it("a field role sees no money capabilities (spec 46 posture, derived)", () => {
    const caps = capabilitiesForRole("site_admin");
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.map((e) => e.key)).not.toContain("payroll");
    expect(caps.map((e) => e.key)).not.toContain("accounting");
  });

  it("rolesForCapability returns the live membership; unknown key → empty", () => {
    expect(rolesForCapability("staff-approve")).toBe(roleHomeModule.STAFF_APPROVAL_ROLES);
    expect(rolesForCapability("no-such-key")).toEqual([]);
  });
});
