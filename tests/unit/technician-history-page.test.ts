// Spec 388 U2 (D3) — /technician/history is the ช่าง's ATTENDANCE record.
//
// Spec 376 U3 had made it the money half; that tab then recorded 0 route views
// ALL-TIME, and two of its three sections were empty by construction
// (wage_payments 0 rows all-time, pending bank 0). So the money moved to
// หน้าหลัก and this route took the one subject with real rows — 189 muster scans
// across 29 workers in 30 days, which no surface had ever shown a ช่าง.
//
// Source-scan pins in the style of technician-home.test.ts: the route must gate
// to technician ONLY, read on the RLS session client (never admin), read through
// the DEFINER RPC rather than the table, render the attendance list, carry none
// of the money half, and mount the chrome that makes it reachable.
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

  // Exact use count, not a ≥2 floor: 2 = the import PLUS one render. A floor
  // stays green with the JSX deleted once a symbol has two real uses.
  it("renders the attendance month grid (spec 388 U4)", () => {
    expect(page.split("WorkerAttendanceMonth").length - 1).toBe(2);
  });

  // U4: month navigation is a real link, so the anchor must come from the
  // shared resolver — an unclamped ?m= reaches the grid as an expanded-year ISO
  // string and renders a mislabeled century (spec 374's lesson, reused).
  it("resolves ?m= through the shared month resolver and offers both directions", () => {
    expect(page).toContain("resolveMonthAnchor");
    expect(page.split("addMonthsIso").length - 1).toBeGreaterThanOrEqual(3);
    expect(page).toContain("prevHref");
    expect(page).toContain("nextHref");
  });

  // ⚠️ The load-bearing read. muster_attendance's ONLY select policy keys on
  // can_see_project, which falls to `else false` for technician — so a plain
  // table read here returns zero rows for every ช่าง, always. Reverting to one
  // would look perfectly reasonable and render a permanently empty page.
  it("reads through the self-scoped DEFINER RPC, never the table directly", () => {
    expect(page).toContain('rpc("get_my_attendance")');
    expect(page).not.toContain('from("muster_attendance")');
  });

  // Spec 388 U2 (D4/D5) — the money half moved to หน้าหลัก. Bare literals, not
  // quote-wrapped: a revert to a differently-quoted call would slip a
  // quote-wrapped absence pin.
  it("carries none of the money half any more", () => {
    expect(page).not.toContain("get_my_wage_payments");
    expect(page).not.toContain("stock_issues");
    expect(page).not.toContain("worker_bank_change_requests");
    expect(page).not.toContain("WorkerHistorySections");
  });

  it("uses the SSOT'd page title rather than a loose literal", () => {
    expect(page.split("ATTENDANCE_OWN_LABEL").length - 1).toBeGreaterThanOrEqual(3);
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
  });
});
