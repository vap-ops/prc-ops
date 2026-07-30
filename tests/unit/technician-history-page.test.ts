// Writing failing test first.
//
// Spec 376 U3 (D3) — the ประวัติ route. /technician was one unbroken scroll page;
// the money half (รายการรอรับ, wage history, bank) now lives at
// /technician/history behind the new ประวัติ tab. Source-scan pins in the style of
// technician-home.test.ts: the route must gate to the technician role ONLY, read
// on the RLS session client (never admin — every read here is the caller's own
// row), render the extracted WorkerHistorySections, and mount the chrome that
// makes it reachable (the tab bar is a technician's only way between the two
// routes, and the desktop strip is rule 2's counterpart).
//
// Counted over comment-STRIPPED source: a doc comment naming a symbol otherwise
// satisfies a toContain pin with the real call deleted (the
// comment-quotes-the-symbol trap, mutation-proven in this repo 2026-07-29).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = stripComments(readFileSync(join(APP, "technician", "history", "page.tsx"), "utf8"));

describe("/technician/history (spec 376 U3)", () => {
  it("gates to the technician role only, like its หน้าหลัก sibling", () => {
    expect(page).toContain('requireRole(["technician"])');
  });

  it("reads on the RLS session client, never the admin client", () => {
    expect(page).toContain('from "@/lib/db/server"');
    expect(page).not.toContain('from "@/lib/db/admin"');
    expect(page).not.toContain("createAdminClient");
  });

  // ≥2 = the import PLUS a real render. A bare toContain is satisfied by the
  // import line alone, so deleting the JSX would keep it green.
  it("renders the extracted WorkerHistorySections", () => {
    expect(page.split("WorkerHistorySections").length - 1).toBeGreaterThanOrEqual(2);
  });

  // The reads the money half needs, each already RLS-self-scoped on the
  // workers.user_id binding — copied from the หน้าหลัก page, not re-invented.
  it("loads the wage payments, receipts, pending-bank and the pay-exempt flag", () => {
    expect(page).toContain("get_my_worker_profile");
    expect(page).toContain("get_my_wage_payments");
    expect(page).toContain("stock_issues");
    expect(page).toContain("worker_bank_change_requests");
    expect(page).toContain("bankExempt");
  });

  // A technician's ONLY way from ประวัติ back to หน้าหลัก is the bar (phone) /
  // strip (desktop) — the route is a tab destination, so it carries no back chip.
  it("mounts the technician chrome (bottom bar + desktop strip)", () => {
    expect(page.split("BottomTabBar").length - 1).toBeGreaterThanOrEqual(2);
    expect(page.split("HubNav").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("keeps the ช่าง's logout affordance (the /technician header pattern)", () => {
    expect(page).toContain("LogoutButton");
  });

  // Spec 274 U2 convention — the note that makes an identity-scoped page's
  // emptiness read as intentional. U3 made this the FOURTH such route, and the
  // only one without it: its empty branch says ยังไม่มีข้อมูลช่างของคุณ, which a
  // super_admin viewing-as-technician reads as "this ช่าง has no record" rather
  // than "you are not a ช่าง". /technician, /portal and /client all mount it.
  //
  // Exact use count, not a ≥2 floor: 2 = the import PLUS one render. A floor
  // would stay green with the JSX deleted once the symbol had two real uses.
  it("mounts ViewAsEmptyNote, like the other three identity-scoped routes", () => {
    expect(page.split("ViewAsEmptyNote").length - 1).toBe(2);
    expect(page).toContain("ยังไม่มีข้อมูลช่างของคุณ");
  });
});
