// Writing failing test first.
//
// UX-audit G8 follow-up, recorded by lane portalsr on #980 and MEASURED here
// before being built: page-skeleton.tsx hand-rolled `<main class="bg-page
// min-h-screen overflow-x-clip">`, and 44 of the app's 45 loading.tsx files
// delegate to it — so 44 loading boundaries rendered a <main> that is not a
// scroller under a body the root layout locks (h-full overflow-hidden, spec 64).
//
// The defect is real, not merely a convention breach. Measured in a real browser
// (dev server, root layout, 2026-08-06), because jsdom has no layout engine and
// cannot see this class of bug at all:
//   • phone landscape 812×375 — the CURRENT skeleton's content is 433px tall,
//     the last placeholder row is cut at y=409, and the row has ZERO
//     user-scrollable ancestors (main overflow-y: visible, body overflow-y:
//     hidden). The clipped part is unreachable by any gesture.
//   • the mechanism, isolated at 375×812 with tall content in the same
//     hand-rolled wrapper: 29 of 40 rows below the fold, 0 user-scrollable
//     ancestors — content simply cannot be reached.
//   • positive control, identical content inside PageShell: exactly 1
//     user-scrollable ancestor (the shell's own <main>), so the rows are
//     reachable. Without that control the two runs above prove nothing.
//
// So PageSkeleton renders PageShell. These pins are the class contract (what a
// unit test CAN see); the geometry above is the evidence for why.
//
// The "only page-shell.tsx may contain a <main>" half is NOT re-implemented here
// — the house already owns that scan (design-doctrine.test.ts, "every page
// scroller clips horizontal overflow"). Its allowlist USED to carry
// page-skeleton.tsx as a legal second home, i.e. the guard enshrined the defect;
// it is narrowed to one file and hardened there (any <main> element, not just
// `<main className`, with comments stripped) rather than forked into a bespoke
// variant here.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PageShell } from "@/components/features/chrome/page-shell";
import { PageSkeleton } from "@/components/features/chrome/page-skeleton";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

const SKELETON_SRC = join(
  process.cwd(),
  "src",
  "components",
  "features",
  "chrome",
  "page-skeleton.tsx",
);

function mainOf(ui: React.ReactElement): HTMLElement {
  const { container } = render(ui);
  const mains = container.querySelectorAll("main");
  expect(mains.length, "a page renders exactly one <main>").toBe(1);
  return mains[0] as HTMLElement;
}

/**
 * The shell's own rendered class string, read off PageShell rather than
 * re-typed, so the skeleton and the shell cannot drift apart silently.
 */
function shellClassName(): string {
  const cls = mainOf(<PageShell variant="app">x</PageShell>).className;
  if (!cls.includes("overflow-y-auto")) {
    throw new Error("PageShell no longer renders a scroller — the control is vacuous");
  }
  return cls;
}

describe("PageSkeleton renders the page scroller (UX-audit G8 follow-up)", () => {
  it("delegates to the PageShell COMPONENT, not to a lookalike <main>", () => {
    // Every className assertion below reads PageShell's own output, so all of
    // them pass against a hand-rolled <main> carrying the same class string —
    // they pin the CONTRACT, not the delegation (fresh-eyes finding). This is the
    // pin that separates the two, and it is the cheap half of the pair: the
    // repo-wide "only page-shell.tsx contains a <main>" scan in
    // design-doctrine.test.ts is the other.
    // Comments stripped first — the component's own header quotes the markup it
    // used to render, so documenting the hazard would otherwise BE the hazard
    // (this assertion caught exactly that on its first run).
    const source = readFileSync(SKELETON_SRC, "utf8")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    expect(source).toMatch(/<PageShell\b/);
    expect(source, "the skeleton must not hand-roll a <main> (ui-conventions §5)").not.toMatch(
      /<main[\s>]/,
    );
  });

  it("renders PageShell's <main>, byte-for-byte the shell's own classes", () => {
    expect(mainOf(<PageSkeleton />).className).toBe(shellClassName());
  });

  it("carries the scroller contract and has dropped min-h-screen", () => {
    // Named separately from the equality pin above so a failure says WHICH half
    // of the contract broke. min-h-screen is the specific defect: it makes the
    // <main> taller than a locked body instead of scrolling inside it. Stated
    // honestly: because the string under test is PageShell's own output, the
    // negative arm bites the reachable regression — a `className="min-h-screen"`
    // passed INTO the shell (mutation-proved) — not a hand-rolled wrapper, which
    // the delegation pin above is what catches.
    const className = mainOf(<PageSkeleton />).className;

    expect(className).toContain("h-full");
    expect(className).toContain("overflow-y-auto");
    expect(
      className,
      "a min-h-screen <main> under body{overflow:hidden} clips its own overflow " +
        "with no way for a user to scroll to it (measured: phone landscape)",
    ).not.toContain("min-h-screen");
  });

  it("mirrors the page width — both containers carry PAGE_MAX_W, not a private one", () => {
    // Writing failing test first (2026-08-06, operator sign-off on the
    // 65-consolidation queue entry). The skeleton stands in for a real page, so a
    // width it does not share is a horizontal JUMP at the fallback→content swap.
    // Measured on ONE route with both states in the same DOM (/dashboard, real
    // root layout): at 1280×800 the fallback's containers are 768px and the real
    // page's are 1240 — a 472px jump; at 900 it is 768 vs 860. Below `md` both
    // clamp to the viewport (335 at 375px), so this is a desktop/tablet defect
    // only. `max-w-3xl` appears in exactly TWO places in all of src/ and both are
    // this file — the skeleton was the last width outlier in the app.
    //
    // The expected value is read off PAGE_MAX_W itself, never re-typed, so the
    // skeleton cannot drift when spec 41's token changes.
    const { container } = render(<PageSkeleton />);

    const containers = [...container.querySelectorAll("main .mx-auto")];
    expect(containers.length, "the skeleton's two centred containers").toBe(2);
    for (const el of containers) {
      expect(el.className, `${el.className} must carry PAGE_MAX_W`).toContain(PAGE_MAX_W);
    }
    expect(
      container.innerHTML,
      "max-w-3xl was the skeleton's private width — spec 41 has exactly one",
    ).not.toContain("max-w-3xl");
  });

  it("still announces itself and still paints the frame it is announcing", () => {
    // The shell swap must cost nothing: the sr-only line that all 44 delegating
    // boundaries inherit, and the pulsing blocks a sighted user reads as "this
    // page is coming", both survive. Counts are EXACT — a floor lets a
    // placeholder row be deleted under a pin whose stated job is the frame.
    const { container } = render(<PageSkeleton />);

    const announcement = container.querySelector(".sr-only");
    expect(announcement?.textContent?.trim()).toBe("กำลังโหลด…");
    expect(container.querySelectorAll("main header").length).toBe(1);
    expect(container.querySelectorAll("main .bg-sunk").length).toBe(8);
    expect(container.querySelectorAll("main .animate-pulse").length).toBe(8);
  });
});
