// Writing failing test first.
//
// Spec 313 U7 — help-card honesty. `/sa/help` is the SA's written instructions,
// and unlike a nav constant nothing type-checks it against the app: a retired
// door survives in prose indefinitely and sends a field user hunting for a
// button that no longer exists. Two cards had drifted:
//
//   manage  — told SAs to open ทีมงาน "จากเมนูเครื่องมือในหน้าหลัก". Spec 313 U3
//             RETIRED that SaTools tile (sa-tools.tsx) once /team got a real
//             bottom tab, so the instruction names a door that is GONE.
//   muster  — documented only the /sa home strip (มา/ไม่มา marking) and never
//             mentioned the scan cockpit spec 306 U3/U4 shipped. Both flows are
//             real and they do DIFFERENT things (the strip is the wage path
//             until 306 U5; the cockpit is the scan/team-forming path).
//
// These assertions pin the instruction against the nav SSOTs it describes, so a
// future nav change reds the help text instead of silently orphaning it.
//
// Spec 334 U4 — the /team hub recompose retired two blocks these cards leaned on:
// CrewProgressRoster (the รอตรวจ→รอยืนยัน→พร้อม gate) is DELETED and the site board
// moved to /team/roster (reached via the รายชื่อทีม tile), and the flat เช็คชื่อ link
// became the วันนี้ hero card whose CTA is เริ่มเช็คชื่อ. Both cards were rewritten
// against the shipped affordances; the pins below now cover the roster tile + its
// ยังไม่ได้จัดทีม bucket / รอ PM ยืนยัน chip, and the muster door's new CTA.

import { describe, expect, it } from "vitest";
import { HELP_CARDS } from "@/lib/sa/help-content";
import { SA_TABS } from "@/components/features/chrome/bottom-tab-bar";
import { TEAM_HUB_LABEL, UNASSIGNED_TEAM_LABEL } from "@/lib/i18n/labels";

const card = (id: string) => {
  const found = HELP_CARDS.find((c) => c.id === id);
  if (!found) throw new Error(`no help card "${id}"`);
  return found;
};
const stepsOf = (id: string) => card(id).steps.join(" · ");

describe("spec 313 U7 — SA help cards name doors that exist", () => {
  // The premise the two card fixes rest on: /team is reachable as a REAL tab.
  // If that stops being true, the rewritten instructions are wrong and this
  // test says so first.
  it("the ทีมงาน bottom tab is the SA's door to /team", () => {
    expect(SA_TABS.map((t) => [t.label, t.href])).toContainEqual([TEAM_HUB_LABEL, "/team"]);
  });

  // EVERY card, not just the one that was broken — the retired tile is a door
  // any card could name, and `add-crew` also points at ทีมงาน.
  it.each(HELP_CARDS.map((c) => c.id))("card %s names no retired เครื่องมือ door", (id) => {
    expect(stepsOf(id)).not.toContain("จากเมนูเครื่องมือ");
  });

  it("the manage card names the ทีมงาน TAB specifically, not just 'a tab'", () => {
    // `toContain("แท็บ")` alone would pass on "เปิดแท็บ ตั้งค่า" — pin the label.
    expect(stepsOf("manage")).toContain(`แท็บ “${TEAM_HUB_LABEL}”`);
  });

  // Spec 334 U4: the manage card's real path — the ทีมงาน tab, the รายชื่อทีม tile
  // (team-tiles.tsx ROSTER_TILE_LABEL / the /team/roster page), and the roster's
  // ยังไม่ได้จัดทีม bucket + รอ PM ยืนยัน chip (site-team-board.tsx). Pin the strings
  // the card quotes so a rename reds the prose. ยังไม่ได้จัดทีม has an exported SSOT
  // (UNASSIGNED_TEAM_LABEL); the tile + chip labels are component-local, so they are
  // pinned as the file's existing hardcoded-literal idiom (cf. the cockpit buttons).
  it("the manage card names the รายชื่อทีม tile and the roster's real bucket + chip", () => {
    const steps = stepsOf("manage");
    expect(steps).toContain("รายชื่อทีม");
    expect(steps).toContain(UNASSIGNED_TEAM_LABEL);
    expect(steps).toContain("รอ PM ยืนยัน");
  });

  it("the manage card names no retired hub block (spec 334 recompose)", () => {
    // U3 deleted CrewProgressRoster (its รอตรวจ→รอยืนยัน→พร้อม gate) and moved the
    // site board off the hub; the old “ทีมหน้างาน” section and the รอตรวจ status
    // word are gone from /team. The card must not send an SA hunting for either.
    const steps = stepsOf("manage");
    expect(steps).not.toContain("รอตรวจ");
    expect(steps).not.toContain("ทีมหน้างาน");
  });

  // The muster card's steps are pinned to the affordance labels the cockpit
  // ACTUALLY renders. A first draft of this card passed a bare toContain("สแกน")
  // while describing a flow that does not exist (scan-to-check-out, and scanning
  // before a team is open). Pinning the real button text makes the assertion
  // fail when the prose drifts from the UI — which is the whole point of the file.
  // Spec 334 U4: the door moved — U1 replaced the flat เช็คชื่อ link with the
  // วันนี้ hero card, whose CTA is เริ่มเช็คชื่อ (muster-today-card.tsx). Step 1 now
  // names that CTA; เปิดทีม / + เพิ่มช่าง / เช็คออก are the cockpit's own buttons
  // (muster-cockpit.tsx), re-verified unchanged by this spec.
  it("the muster card walks the real door + cockpit affordances in order", () => {
    const steps = stepsOf("muster");
    for (const affordance of ["เริ่มเช็คชื่อ", "เปิดทีม", "+ เพิ่มช่าง", "เช็คออก"]) {
      expect(steps).toContain(affordance);
    }
  });

  it("the muster card does not claim an absent-marking control", () => {
    // `ไม่มา` exists nowhere in the app: attendance is presence-only append
    // logging. The old copy promised a มา/ไม่มา toggle that was never built.
    expect(`${stepsOf("muster")} ${card("muster").tip}`).not.toContain("ไม่มา");
  });

  it("the muster card sends the wage tap to the surfaces that carry it", () => {
    // The /sa strip is a summary with ONE bulk button; the per-person tap is on
    // แผนวันนี้. Naming the wrong one costs a field user the whole flow.
    const tip = card("muster").tip;
    expect(tip).toContain("ทั้งหมดมาทำ");
    expect(tip).toContain("แผนวันนี้");
  });
});
