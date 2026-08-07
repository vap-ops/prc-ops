// Writing failing test first.
//
// From the cross-lane fact-check of the route-announcement arc. Since #986 the
// live region speaks the destination's page name on arrival, so two routes that
// share a `metadata.title` announce the SAME WORD. The `key={seq}` identity
// guarantees the region mutates, so it does speak — but it cannot tell the
// listener they moved. Measured: 4 title strings were shared by 2–3 routes each.
//
// ── What counts as a defect, and what does not ──────────────────────────────
// Two DIFFERENT things sharing a name is the defect. The SAME thing reached by
// two routes is not — and both shapes were present, so this guard exempts the
// second explicitly rather than forcing a rename that would make a title
// contradict the page's own heading:
//
//   /client and /client/[projectId] — the index renders
//   `ClientProjectList`, whose own <h1> IS "ความคืบหน้าโครงการ". Renaming the
//   index would put its title at odds with the heading on screen. Both really
//   are project progress; separating them means a per-RECORD title, which is a
//   different problem (39 dynamic routes carry one title for every record).
//
//   /registrations/[id] and /sa/registrations/[id] — one screen, two audiences.
//   A given user only ever reaches one of them.
//
// Exemptions are VERIFIED, not trusted: every entry must still exist and must
// still actually share a title, so a stale one reds instead of rotting.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(process.cwd(), "src", "app");

/**
 * Route groups that may legitimately share one title, each with its reason.
 * Keyed by the shared title; the value lists the routes allowed to carry it.
 */
const SHARED_ON_PURPOSE: Record<string, { routes: string[]; reason: string }> = {
  ความคืบหน้าโครงการ: {
    routes: ["client/page.tsx", "client/[projectId]/page.tsx"],
    reason:
      "the client-portal index renders ClientProjectList, whose own <h1> is this exact " +
      "string — renaming it would make the title contradict the heading on screen; both " +
      "genuinely are project progress, and separating them needs a per-record title",
  },
  รายละเอียดคำขอสมัคร: {
    routes: ["registrations/[id]/page.tsx", "sa/registrations/[id]/page.tsx"],
    reason:
      "one screen, two audiences (back-office vs site-admin); a given user only ever " +
      "reaches one of them, so they never announce twice in a session",
  },
};

/**
 * A REAL collision that is not fixed yet because fixing it needs a decision the
 * operator has to make, not a rename. Separate from SHARED_ON_PURPOSE on
 * purpose: that map means "correct", this one means "known defect, parked".
 */
const NEEDS_A_DECISION: Record<string, { routes: string[]; reason: string }> = {
  จัดซื้อ: {
    routes: ["procurement/page.tsx", "procurement/[section]/page.tsx"],
    reason:
      "the hub and its three STR sections (ขอบเขต · เวลา · ทรัพยากร) share one title, and the " +
      "bottom-tab spine lands on the sections — so pressing a tab announces จัดซื้อ again. " +
      "The sections are a closed typed set that already carries labels " +
      "(PROCUREMENT_STR_SECTIONS), so the fix is generateMetadata returning the section's " +
      "own label — but that would be this app's FIRST generateMetadata across 135 pages, " +
      "i.e. a convention change, so it is raised rather than taken unilaterally",
  },
};

function allPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(APP, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name === "page.tsx") out.push(join(dir, e.name).split("\\").join("/"));
    }
  };
  walk("");
  return out;
}

/**
 * The page's own static title, or null (a redirect stub, or `generateMetadata`).
 *
 * Covers BOTH forms — a quoted literal and a shared constant. A literal-only
 * scan is how the first count of this defect came in short: four constants
 * (`ORDERING_TEMPLATES_LABEL`, `MONEY_REVIEW_LABEL`, `EQUIPMENT_RENTAL_LABEL`,
 * `BOQ_TEMPLATES_LABEL`) were each carried by two pages and were invisible to
 * it. Two pages sharing a constant necessarily share the title, so the
 * identifier's NAME is a sound key.
 *
 * Declared limit: a page whose constant RESOLVES to another page's literal is
 * still missed. No such pair exists today (checked), and closing it would mean
 * resolving imports here.
 */
function staticTitleOf(rel: string): string | null {
  const src = readFileSync(join(APP, rel), "utf8");
  const block = /export const metadata[\s\S]{0,400}?title:\s*([^,\n}]+)/.exec(src)?.[1]?.trim();
  if (!block) return null;
  const literal = /^"([^"]+)"/.exec(block)?.[1];
  if (literal) return literal;
  const ident = /^([A-Z_][A-Z0-9_]*)\b/.exec(block)?.[1];
  return ident ?? null;
}

describe("no two routes announce the same page name", () => {
  const titled = allPages()
    .map((file) => ({ file, title: staticTitleOf(file) }))
    .filter((p): p is { file: string; title: string } => p.title !== null);

  it("reads a real corpus of titles (the scan is not vacuous)", () => {
    expect(titled.length).toBeGreaterThan(120);
  });

  it("has no unexpected duplicate title", () => {
    const byTitle = new Map<string, string[]>();
    for (const { file, title } of titled) {
      byTitle.set(title, [...(byTitle.get(title) ?? []), file]);
    }

    const offenders = [...byTitle.entries()]
      .filter(([title, files]) => {
        if (files.length < 2) return false;
        const allowed = SHARED_ON_PURPOSE[title] ?? NEEDS_A_DECISION[title];
        if (!allowed) return true;
        // Exempt only the exact route set that was justified — a THIRD page
        // joining the same title is a new defect, not covered by the old reason.
        return [...files].sort().join("|") !== [...allowed.routes].sort().join("|");
      })
      .map(([title, files]) => `${title} → ${files.join(", ")}`);

    expect(
      offenders,
      "two routes carry the same metadata.title, so arriving at either announces the " +
        "same word and a screen-reader user cannot tell they moved. Give the more " +
        "specific one its own name, or record it in SHARED_ON_PURPOSE with a reason",
    ).toEqual([]);
  });

  it("keeps the exemptions honest — each must still exist and still share", () => {
    const titles = new Map(titled.map((p) => [p.file, p.title]));

    const recorded = { ...SHARED_ON_PURPOSE, ...NEEDS_A_DECISION };
    for (const [title, { routes, reason }] of Object.entries(recorded)) {
      expect(reason.length, `SHARED_ON_PURPOSE["${title}"] needs a reason`).toBeGreaterThan(40);
      expect(routes.length, `"${title}" exempts fewer than two routes`).toBeGreaterThanOrEqual(2);
      for (const route of routes) {
        expect(titles.has(route), `exempt route ${route} no longer has a static title`).toBe(true);
        expect(
          titles.get(route),
          `${route} no longer carries "${title}" — drop the stale exemption`,
        ).toBe(title);
      }
    }
  });
});
