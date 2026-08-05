// Writing failing test first.
//
// UX-audit G8 follow-up, recorded by lane portalsr on #980 and MEASURED here
// before being built: page-skeleton.tsx hand-rolled `<main class="bg-page
// min-h-screen overflow-x-clip">`, and 38 of the app's 39 loading.tsx files
// delegate to it — so 38 loading boundaries rendered a <main> that is not a
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
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { PageShell } from "@/components/features/chrome/page-shell";
import { PageSkeleton } from "@/components/features/chrome/page-skeleton";

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

/**
 * Strip comments before any raw-text scan (house rule): every other `<main` in
 * src/ today is prose ABOUT the spec-64 lock — documenting the hazard must not
 * trip the guard against it. Line comments are only stripped when they start the
 * line, so a `https://` inside a string can never swallow code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const SRC = join(process.cwd(), "src");
const PAGE_SHELL = join(SRC, "components", "features", "chrome", "page-shell.tsx");

describe("PageSkeleton renders the page scroller (UX-audit G8 follow-up)", () => {
  it("renders PageShell's <main>, byte-for-byte the shell's own classes", () => {
    expect(mainOf(<PageSkeleton />).className).toBe(shellClassName());
  });

  it("carries the scroller contract and has dropped min-h-screen", () => {
    // Named separately from the equality pin above so a failure says WHICH half
    // of the contract broke. min-h-screen is the specific defect: it makes the
    // <main> taller than a locked body instead of scrolling inside it.
    const className = mainOf(<PageSkeleton />).className;

    expect(className).toContain("h-full");
    expect(className).toContain("overflow-y-auto");
    expect(
      className,
      "a min-h-screen <main> under body{overflow:hidden} clips its own overflow " +
        "with no way for a user to scroll to it (measured: phone landscape)",
    ).not.toContain("min-h-screen");
  });

  it("still announces itself and still paints the frame it is announcing", () => {
    // The shell swap must be an ADDITION-free change: the sr-only line that all
    // 38 delegating boundaries inherit, and the pulse blocks a sighted user
    // reads as "this page is coming", both survive.
    const { container } = render(<PageSkeleton />);

    const announcement = container.querySelector(".sr-only");
    expect(announcement?.textContent?.trim()).toBe("กำลังโหลด…");
    expect(container.querySelectorAll("main header").length).toBe(1);
    expect(container.querySelectorAll("main .bg-sunk").length).toBeGreaterThanOrEqual(7);
  });
});

describe("no surface hand-rolls a <main> (ui-conventions §5, spec 63/64)", () => {
  const files = tsxFilesUnder(SRC).filter((file) => file !== PAGE_SHELL);

  it("scans a real file set and can actually see a <main> (not a vacuous scan)", () => {
    // A scan that matches nothing passes forever. Floor the population, and
    // prove the matcher fires on the one file that legitimately owns a <main>.
    expect(files.length).toBeGreaterThan(300);
    expect(stripComments(readFileSync(PAGE_SHELL, "utf8"))).toMatch(/<main[\s>]/);
  });

  it("only page-shell.tsx contains a <main> element", () => {
    const offenders = files.filter((file) =>
      /<main[\s>]/.test(stripComments(readFileSync(file, "utf8"))),
    );

    expect(
      offenders.map((file) => file.slice(SRC.length + 1).replace(/\\/g, "/")),
      "the body is locked (h-full overflow-hidden, spec 64) and PageShell's <main> " +
        "is the only scroller — a hand-rolled <main> silently clips whatever does not fit",
    ).toEqual([]);
  });
});
