// Writing failing test first.
//
// Spec 291 U2 (TASK 6) — loadProfileCard is a pure, RLS-scoped loader for the
// /profile employee-ID card: identity + STATUSES ONLY, never PDPA values. Pins:
// - reads go through the passed (RLS-scoped) client only;
// - a missing registration/consent row yields null, never a throw;
// - consent's revoked_at null/non-null maps to "given"/"revoked";
// - the module source never mentions a PDPA-value column name.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadProfileCard } from "@/lib/profile/load-profile-card";

function makeSupabase(tables: Record<string, unknown | null>) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) {
        builder[m] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve({ data: tables[table] ?? null, error: null });
      return builder;
    },
  };
}

const USER = {
  role: "site_admin",
  full_name: "สมชาย ใจดี",
  line_avatar_url: "https://line.example/avatar.png",
  department_id: "dept-1",
};

describe("loadProfileCard", () => {
  it("returns department name + employee id + registration status when those rows exist", async () => {
    const supabase = makeSupabase({
      users: USER,
      departments: { name_th: "ฝ่ายก่อสร้าง" },
      staff_registrations: { employee_id: "PRC-26-0001", status: "approved" },
      staff_consents: { consented_at: "2026-07-01T00:00:00Z", revoked_at: null },
    });

    const card = await loadProfileCard(supabase as never, "u1");

    expect(card.fullName).toBe("สมชาย ใจดี");
    expect(card.role).toBe("site_admin");
    expect(card.avatarUrl).toBe("https://line.example/avatar.png");
    expect(card.departmentName).toBe("ฝ่ายก่อสร้าง");
    expect(card.employeeId).toBe("PRC-26-0001");
    expect(card.registration).toEqual({ status: "approved" });
    expect(card.pdpaConsent).toEqual({ status: "given", at: "2026-07-01T00:00:00Z" });
  });

  it("returns registration: null and pdpaConsent: null when those rows are absent", async () => {
    const supabase = makeSupabase({
      users: { ...USER, department_id: null },
      staff_registrations: null,
      crew_registrations: null,
      staff_consents: null,
      contractor_consents: null,
    });

    const card = await loadProfileCard(supabase as never, "u1");

    expect(card.departmentName).toBeNull();
    expect(card.employeeId).toBeNull();
    expect(card.registration).toBeNull();
    expect(card.pdpaConsent).toBeNull();
  });

  it('maps a revoked consent (revoked_at set) to status "revoked"', async () => {
    const supabase = makeSupabase({
      users: { ...USER, department_id: null },
      staff_registrations: null,
      staff_consents: { consented_at: "2026-06-01T00:00:00Z", revoked_at: "2026-06-15T00:00:00Z" },
    });

    const card = await loadProfileCard(supabase as never, "u1");

    expect(card.pdpaConsent).toEqual({ status: "revoked", at: "2026-06-01T00:00:00Z" });
  });

  it("never selects or mentions PDPA-value columns in the module source", () => {
    const src = readFileSync("src/lib/profile/load-profile-card.ts", "utf8");
    for (const forbidden of [
      "national_id",
      "bank",
      "day_rate",
      "date_of_birth",
      "emergency_contact",
    ]) {
      expect(src, `module source must never mention "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
