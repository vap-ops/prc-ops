// Writing failing test first.
//
// Spec 264 G3 / ADR 0072 §8 — the new minimal /technician home, the anti-dead-end
// landing an approved technician reaches (roleHome('technician') → /technician,
// pinned in role-home.test.ts). Source-scan pins (mirrors
// registrations-gate-parity.test.ts): the page must gate to the technician role
// ONLY, read its data on the RLS session (never the admin client — the applicant
// reads its own row), reuse the shipped EmployeeCard + own-registration resolver,
// and carry the assigned-WPs surface (spec 264 placeholder → spec 350 real card).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");
const read = (...segs: string[]) => readFileSync(join(APP, ...segs), "utf8");
// Spec 376 U3 — the order + absence pins below are counted over comment-STRIPPED
// source: this page's doc comment names the very symbols they assert are gone
// (the comment-quotes-the-symbol trap, mutation-proven in this repo 2026-07-29).
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("/technician home (spec 264 G3)", () => {
  const page = read("technician", "page.tsx");

  it("gates to the technician role only", () => {
    expect(page).toContain('requireRole(["technician"])');
  });

  it("reads on the RLS session client, never the admin client", () => {
    expect(page).toContain('from "@/lib/db/server"');
    expect(page).not.toContain('from "@/lib/db/admin"');
    expect(page).not.toContain("createAdminClient");
  });

  it("reuses the shipped e-card + own-registration read (no re-roll)", () => {
    expect(page).toContain("EmployeeCard");
    // The own-row read helper + the card-photo resolver are reused, not re-rolled.
    expect(page).toContain("getOwnTechnicianRegistration");
    expect(page).toContain("resolveCardPhoto");
  });

  it("wires the assigned-work card, retiring the coming-soon placeholder (spec 350)", () => {
    // The room-to-grow slot is now the real card (get_my_assigned_work → view → card).
    expect(page).toContain("AssignedWorkCard");
    expect(page).toContain("buildAssignedWorkView");
    expect(page).not.toContain("ComingSoonBadge");
  });

  it("is a role-home destination — no DetailHeader back chip (spec 63 nav rule)", () => {
    // Like /portal and /client, /technician is a primary landing, not a drill-down.
    expect(page).not.toContain("DetailHeader");
  });
});

// Writing failing test first.
//
// Spec 376 U3 (D3) — หน้าหลัก after the split. The page kept everything: e-card,
// QR, assigned work, wage, bank, consents, receipts, no chrome. Now it is the
// DAILY half with a tab bar, and the QR badge leads because it is the artifact a
// ช่าง is actually asked for at the morning talk (the e-card led before, and it is
// read-once identity).
describe("/technician home after the ประวัติ split (spec 376 U3)", () => {
  const page = stripComments(read("technician", "page.tsx"));

  // ≥2 = the import PLUS a real mount; a bare toContain is satisfied by the
  // import line alone.
  it("mounts the technician chrome (bottom bar + desktop strip)", () => {
    expect(page.split("BottomTabBar").length - 1).toBeGreaterThanOrEqual(2);
    expect(page.split("HubNav").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("leads with the QR badge, before the assigned work and the e-card", () => {
    const qr = page.indexOf("<WorkerBadgeQr");
    const work = page.indexOf("<AssignedWorkCard");
    const card = page.indexOf("<EmployeeCard");
    expect(qr).toBeGreaterThan(-1);
    expect(work).toBeGreaterThan(qr);
    expect(card).toBeGreaterThan(work);
  });

  // The money half moved to /technician/history — with its READS, not just its
  // JSX. A page that still fetches wage/receipt/bank data is doing the work of a
  // route it no longer renders.
  // Spec 388 U2 (D4/D5) — the money half came BACK from /technician/history when
  // that route became attendance. This inverts the spec-376 pins that used to
  // live here, deliberately: the bank belongs on the page /settings/my-info has
  // always pointed at by name ("…ได้ที่ หน้าหลักช่าง"), which spec 376 U3 had
  // left aimed at a page with no bank on it.
  it("loads the money half's data again", () => {
    expect(page).toContain("get_my_wage_payments");
    expect(page).toContain("stock_issues");
    expect(page).toContain("worker_bank_change_requests");
    expect(page).toContain("bankExempt");
  });

  it("hosts BOTH halves: identity and the money block", () => {
    expect(page.split("WorkerPortalSections").length - 1).toBeGreaterThanOrEqual(2);
    expect(page.split("WorkerHistorySections").length - 1).toBe(2);
  });

  // D5: รายการรอรับ is the only write a ช่าง owns. It must sit ABOVE the assigned
  // work — the ordering is the unit's point, not decoration, so pin the
  // positions rather than mere presence.
  it("puts the receipts above the assigned-work card", () => {
    expect(page.split("PortalReceipts").length - 1).toBe(2);
    expect(page.indexOf("<PortalReceipts")).toBeLessThan(page.indexOf("<AssignedWorkCard"));
    // …and below the QR badge, which is the one thing they open the app for.
    expect(page.indexOf("<WorkerBadgeQr")).toBeLessThan(page.indexOf("<PortalReceipts"));
  });
});
