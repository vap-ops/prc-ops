// Writing failing test first.
//
// #980 follow-up. That unit gave src/app/portal/loading.tsx the same sr-only
// `กำลังโหลด…` the other 38 boundaries inherit from page-skeleton.tsx, and said so
// honestly in its own comment: a plain sr-only <p> is NOT a live region. A
// Next.js loading.tsx fallback is a DOM swap during a client-side navigation,
// and readers announce inserted nodes only inside a live region — so the line is
// reliably read only on a full page load, where the reader walks the document
// top-down before the fallback is replaced. Parity, not audibility.
//
// The robust shape (and the one this file pins): ONE region, mounted once in the
// root layout, ALREADY IN THE DOM before any navigation starts, whose CONTENT
// mutates when a boundary appears. A region inserted together with its own text
// is the classic silent-failure case — which is exactly why the fix must not be
// a role="status" added per boundary, and why the repo-wide scan below forbids
// that shape.
//
// SCOPE, and it was narrowed by measurement rather than by reading a file. The
// unit covers the PENDING window only — the seconds a heavy route (/team: 12
// awaited reads) spends on its skeleton. Reading
// node_modules/next/dist/client/components/app-router-announcer.js suggests
// ARRIVAL is already handled: Next mounts a persistent shadow-DOM
// role="alert"/aria-live="assertive" node and speaks document.title on every
// tree change. Driven on a live dev server it does NOT — across four
// client-side navigations it stayed empty on three whose title had provably
// changed, and on the fourth announced the SA home's <h1> greeting. It samples
// the title before Next swaps it, then falls back to querySelector("h1").
// Arrival is therefore an OPEN gap, not a covered one. This unit still does not
// build it (that needs its own decision about what to say and when), but the
// reason is scope, not redundancy — and POLITE is chosen on the house rule that
// waiting is not an emergency, not because something else will speak first.

import { act, cleanup, render, screen } from "@testing-library/react";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RouteAnnouncer } from "@/components/features/chrome/route-announcer";
import {
  ROUTE_LOADING_MESSAGE,
  beginRouteLoading,
  getRouteAnnouncement,
  getServerRouteAnnouncement,
  subscribeRouteAnnouncement,
} from "@/lib/ui/route-announcement";

afterEach(cleanup);

/**
 * Comments must go before any raw-text scan, or explaining the hazard becomes
 * the hazard — a boundary whose comment says "do not add aria-live here" would
 * trip the very rule it documents. Line comments are stripped too, but only
 * when not preceded by `:` so URLs survive.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("route-announcement store", () => {
  it("announces while a boundary is mounted and falls silent when it releases", () => {
    expect(getRouteAnnouncement().message).toBe("");

    const release = beginRouteLoading();
    expect(getRouteAnnouncement().message).toBe(ROUTE_LOADING_MESSAGE);

    release();
    expect(getRouteAnnouncement().message).toBe("");
  });

  it("ref-counts nested boundaries — an inner release must not silence the outer one", () => {
    // Next.js applies the nearest loading.tsx, but a parent segment's boundary
    // can still be mounted while a child's appears. A naive boolean would clear
    // on the first release and leave the user's reader silent mid-load.
    const outer = beginRouteLoading();
    const inner = beginRouteLoading();

    inner();
    expect(getRouteAnnouncement().message).toBe(ROUTE_LOADING_MESSAGE);

    outer();
    expect(getRouteAnnouncement().message).toBe("");
  });

  it("ignores a double release — a double-invoked cleanup must not underflow the count", () => {
    const outer = beginRouteLoading();
    const inner = beginRouteLoading();

    inner();
    inner();
    expect(
      getRouteAnnouncement().message,
      "a second call to the same release decremented the count again, so the outer " +
        "boundary was silenced while it is still on screen",
    ).toBe(ROUTE_LOADING_MESSAGE);

    outer();
    expect(getRouteAnnouncement().message).toBe("");
  });

  it("gives each announcement a fresh identity so an IDENTICAL message re-announces", () => {
    // Every boundary says the same words. A live region only speaks on a DOM
    // mutation, so navigating A -> B -> C with the same text must still produce
    // three distinct nodes; a message-only store would render byte-identical
    // output and the 2nd and 3rd navigations would be silent.
    const first = beginRouteLoading();
    const firstSeq = getRouteAnnouncement().seq;
    first();

    const second = beginRouteLoading();
    const secondSeq = getRouteAnnouncement().seq;
    second();

    expect(getRouteAnnouncement().message).toBe("");
    expect(secondSeq).not.toBe(firstSeq);
  });

  it("returns a STABLE snapshot reference while nothing changes (useSyncExternalStore contract)", () => {
    // getSnapshot returning a fresh object every call makes React re-render
    // forever ("The result of getSnapshot should be cached").
    expect(getRouteAnnouncement()).toBe(getRouteAnnouncement());
  });

  it("notifies subscribers on begin and on release", () => {
    let calls = 0;
    const unsubscribe = subscribeRouteAnnouncement(() => {
      calls += 1;
    });

    const release = beginRouteLoading();
    expect(calls).toBe(1);
    release();
    expect(calls).toBe(2);

    unsubscribe();
    beginRouteLoading()();
    expect(calls, "unsubscribe did not detach the listener").toBe(2);
  });

  it("keeps the SERVER snapshot empty even while a boundary is announcing", () => {
    // Module state is shared across requests on the server. If getServerSnapshot
    // read the live value, one user's in-flight navigation would be rendered
    // into another user's HTML, and hydration would mismatch.
    const release = beginRouteLoading();
    expect(getServerRouteAnnouncement().message).toBe("");
    expect(getServerRouteAnnouncement()).toBe(getServerRouteAnnouncement());
    release();
  });
});

describe("<RouteAnnouncer> — the persistent region", () => {
  it("is a polite, atomic, screen-reader-only status region that starts EMPTY", () => {
    const { container } = render(<RouteAnnouncer />);
    const region = screen.getByRole("status");

    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.className).toContain("sr-only");
    // Empty at rest is the load-bearing half: a region that already contains its
    // text when it enters the DOM is the silent-failure case this unit exists to
    // avoid, and it would also make every page load speak "กำลังโหลด…".
    expect(region.textContent).toBe("");
    expect(container.textContent).toBe("");
  });

  it("receives the message while a boundary announces, and empties on release", () => {
    render(<RouteAnnouncer />);
    const region = screen.getByRole("status");

    let release: (() => void) | undefined;
    act(() => {
      release = beginRouteLoading();
    });
    expect(region.textContent).toBe(ROUTE_LOADING_MESSAGE);

    act(() => release?.());
    expect(region.textContent).toBe("");
  });

  it("PERSISTS — the same region element survives a whole announce/release cycle", () => {
    // The entire point of the design. If the region were mounted by the boundary
    // it would be inserted already-containing its text and readers would skip it.
    render(<RouteAnnouncer />);
    const before = screen.getByRole("status");

    let release: (() => void) | undefined;
    act(() => {
      release = beginRouteLoading();
    });
    const during = screen.getByRole("status");
    act(() => release?.());
    const after = screen.getByRole("status");

    expect(during).toBe(before);
    expect(after).toBe(before);
  });

  it("replaces the inner node on a REPEAT announcement so identical text speaks twice", () => {
    // The two store writes MUST share one commit. React unmounts a Suspense
    // fallback and mounts the next one in the same pass, so the release and the
    // next begin are batched and the region re-renders exactly once, going
    // straight from "กำลังโหลด…" to "กำลังโหลด…". Split across two act() calls
    // the region empties in between, React tears the node down and rebuilds it
    // for free, and the test passes with or without the key — which is what a
    // surviving mutant proved the first time this was written.
    render(<RouteAnnouncer />);
    const region = screen.getByRole("status");

    let release = (() => {}) as () => void;
    act(() => {
      release = beginRouteLoading();
    });
    const firstNode = region.firstElementChild;

    act(() => {
      release(); // boundary A leaves…
      release = beginRouteLoading(); // …and boundary B arrives, same commit
    });
    const secondNode = region.firstElementChild;

    expect(region.textContent, "the batched swap left the region silent").toBe(
      ROUTE_LOADING_MESSAGE,
    );
    expect(firstNode).not.toBeNull();
    expect(secondNode).not.toBeNull();
    expect(
      secondNode,
      "the second navigation re-used the same element and wrote the same text, so " +
        "no DOM mutation reached the live region — the reader stays silent from " +
        "the 2nd navigation on",
    ).not.toBe(firstNode);

    act(() => release());
  });
});

describe("the region is mounted ONCE, in the root layout", () => {
  const layout = stripComments(readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8"));

  it("renders in src/app/layout.tsx", () => {
    // The root layout is a Server Component vitest cannot render, and WHERE this
    // lives is the whole unit — a region mounted anywhere that unmounts between
    // navigations is the broken shape.
    expect(layout.split("RouteAnnouncer").length - 1).toBe(2); // import + one usage
    expect(layout).toMatch(/\n\s*<RouteAnnouncer \/>\n/);
  });

  it("is a SIBLING of the element that receives {children}, not nested in it", () => {
    // {children} is the subtree Next.js swaps on navigation. The region has to
    // sit beside it at body level so it survives the swap; anything that
    // re-mounts per navigation is inserted together with its own text and is
    // not announced. Both checks fail if the tag is moved inside the wrapper.
    const lines = layout.split("\n");
    const regionLine = lines.find((line) => line.includes("<RouteAnnouncer />"));
    const childrenLine = lines.find((line) => line.includes("{children}"));

    expect(regionLine, "no <RouteAnnouncer /> in the root layout").toBeDefined();
    expect(childrenLine, "the root layout no longer renders {children}").toBeDefined();

    const indentOf = (line: string) => (line.match(/^\s*/)?.[0] ?? "").length;
    expect(
      indentOf(regionLine as string),
      "the region is nested deeper than the element receiving {children} — it is " +
        "inside the swapping subtree, so it is re-created on every navigation",
    ).toBe(indentOf(childrenLine as string));

    // …and it is not textually inside that element either.
    const wrapperStart = layout.indexOf("<ToastProvider>");
    const wrapperEnd = layout.indexOf("</ToastProvider>");
    const usage = layout.indexOf("<RouteAnnouncer />");
    expect(wrapperStart).toBeGreaterThan(-1);
    expect(usage > wrapperStart && usage < wrapperEnd).toBe(false);
  });

  it("no loading boundary mounts a region of its own", () => {
    // The failure this unit is correcting. A role="status" added per boundary
    // enters the DOM already containing its text; screen readers announce
    // mutations of a region that was already there, not the arrival of a
    // pre-filled one. Scanned repo-wide so the next bespoke loading.tsx cannot
    // reintroduce it.
    const sources = allLoadingSources();
    // A zero-match scan reads exactly like a clean one. 39 loading.tsx +
    // page-skeleton.tsx at 0.340.0; the floor only has to prove the glob ran.
    expect(sources.length, "the boundary scan matched nothing — it is not a check").toBeGreaterThan(
      35,
    );

    const offenders = sources
      .filter(({ src }) => /aria-live|role="status"|role="alert"|RouteAnnouncer/.test(src))
      .map(({ file }) => file);

    expect(
      offenders,
      "a loading boundary declares its own live region — it is inserted together " +
        "with its text and will not be announced; write to the layout's region instead",
    ).toEqual([]);
  });
});

/** Every route-level loading boundary in the app, plus the shared skeleton. */
function allLoadingSources(): { file: string; src: string }[] {
  const files = [
    ...globSync("src/app/**/loading.tsx", { cwd: process.cwd() }),
    join("src", "components", "features", "chrome", "page-skeleton.tsx"),
  ];
  return files.map((file) => ({
    file,
    src: stripComments(readFileSync(join(process.cwd(), file), "utf8")),
  }));
}
