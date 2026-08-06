// Writing failing test first.
//
// #986 made arrival audible: on every client-side navigation the persistent live
// region speaks the destination, taken from `document.title` with the
// `— PRC Ops` template suffix stripped. A page that sets no `metadata.title` of
// its own therefore renders the bare default and is announced as NOTHING —
// deliberately, because naming the app tells a listener nothing about where they
// landed, and the `<h1>` is unusable as a fallback (measured: on 4 of 5 sampled
// pages it is the greeting "สวัสดี คุณ<ชื่อ>", i.e. the user's own name).
//
// So a missing title is now a silent page, not just a dull browser tab. This
// guard makes that impossible to ship by accident.
//
// ⚠️ MEASURED, and it corrected the premise this unit started from. The eight
// `page.tsx` files without a title looked like eight silent pages. Six of them
// are REDIRECTS and announce their destination perfectly well — driven in a real
// browser: /contacts → /contacts/customers ("ลูกค้า"), /store and /stock-count →
// /projects ("โครงการ"), / → /dashboard ("ภาพรวม"), and /sa/crew(+/badges) return
// an RSC payload carrying `NEXT_REDIRECT;replace;/team;307` ("ทีมงาน"). An earlier
// probe reported three of them landing on themselves titled "PRC Ops"; that was
// the probe reading before the client-side redirect completed, not the app.
// Only TWO pages genuinely rendered without a name.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(process.cwd(), "src", "app");

/**
 * Pages that legitimately set no title, each with the reason it is exempt.
 * A hand list silently misses the next entry — which is exactly why every entry
 * is VERIFIED below rather than trusted: an exemption must still exist, must
 * still lack a title, and (for the redirect cases) must still actually redirect.
 * A new page cannot be waved through by adding it here without also making it a
 * redirect.
 */
const EXEMPT: Record<string, string> = {
  "page.tsx":
    "the root dispatcher: it redirects a signed-in user to their role home (/dashboard, " +
    "measured) and otherwise renders the signed-out landing, whose name IS the app — the " +
    "layout's default title is already the right answer there",
  "contacts/page.tsx": "redirects to /contacts/customers (ลูกค้า)",
  "store/page.tsx": "spec 197 U1 legacy path — redirects to /projects (โครงการ)",
  "stock-count/page.tsx": "spec 197 U2 legacy path — redirects to /projects (โครงการ)",
  "sa/crew/page.tsx": "spec 313 U1 legacy path — redirects to /team (ทีมงาน)",
  "sa/crew/badges/page.tsx": "spec 313 U1 legacy path — redirects to /team/badges",
};

function allPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(APP, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name === "page.tsx") out.push(join(dir, e.name));
    }
  };
  walk("");
  return out;
}

const read = (rel: string) => readFileSync(join(APP, rel), "utf8");

/** A title can be a literal or a shared constant — only its ABSENCE matters. */
const hasTitle = (src: string) => /export const metadata[\s\S]{0,400}?title\s*:/.test(src);

describe("every page announces a name (arrival announcement, #986)", () => {
  const pages = allPages();

  it("scans the real page set (a zero-match scan is not a check)", () => {
    // 135 at 0.342.0. The floor only has to prove the walk ran.
    expect(pages.length).toBeGreaterThan(120);
  });

  it("every page.tsx sets a metadata title, or is a recorded exemption", () => {
    const silent = pages
      .map((p) => p.split("\\").join("/"))
      .filter((p) => !hasTitle(read(p)) && !(p in EXEMPT));

    expect(
      silent,
      "page(s) with no metadata.title — since #986 the loading region speaks the " +
        "destination on arrival, so a page with no title of its own announces NOTHING. " +
        'Add `export const metadata = { title: "…" }` (reuse a labels.ts constant if ' +
        "the page already renders one), or record it in EXEMPT with its reason",
    ).toEqual([]);
  });

  it("keeps the exemption list honest — no stale or unearned entries", () => {
    const present = new Set(pages.map((p) => p.split("\\").join("/")));

    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect(present.has(path), `EXEMPT lists ${path}, which no longer exists`).toBe(true);
      expect(reason.length, `EXEMPT[${path}] needs a reason`).toBeGreaterThan(20);

      const src = read(path);
      expect(
        hasTitle(src),
        `${path} now sets a title — drop it from EXEMPT rather than carrying a dead exemption`,
      ).toBe(false);
      // The whole justification is that these pages never render a name of their
      // own because they send the user somewhere that has one. An entry that does
      // not redirect is a real page being waved through.
      expect(
        /\bredirect\s*\(/.test(src),
        `${path} is exempt but does not redirect — an exemption may not excuse a page ` +
          `that actually renders; give it a title instead`,
      ).toBe(true);
    }
  });
});
