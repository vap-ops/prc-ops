// Writing failing test first.
//
// #983 made the PENDING window audible (one persistent polite region in the
// root layout, written to by every loading boundary). It deliberately did NOT
// announce ARRIVAL, and recorded why: reading Next's own announcer
// (client/components/app-router-announcer) suggests the framework already does
// it — but driven in real Chrome it does not. This unit closes that gap.
//
// ── What the browser measured, and why each number picked a design choice ────
// Instrumented on a live dev server across real client-side navigations:
//
//   +1073ms  title-node-REMOVED   ""                      ← head briefly has NO title
//   +1074ms  pathname-changed     /projects
//   +1094ms  loading-region       "กำลังโหลด…"
//   +1100ms  title-node-ADDED     "โครงการ — PRC Ops"
//   +1736ms  loading-region       ""                      ← content actually arrives
//
// ① Next REPLACES the <title> NODE rather than mutating its text, so
//    `document.title` is empty for ~1–6ms every navigation. That is the window
//    Next's announcer samples in, which is why it falls through to
//    querySelector("h1"). Root-caused, not guessed. ⇒ we observe document.head
//    for a REPLACED title node, and we never read the title mid-gap.
//
// ② The <h1> is REFUTED as a fallback: on 4 of 5 sampled pages it reads
//    "สวัสดี คุณ<ชื่อ>" — the greeting, i.e. the USER'S OWN NAME, not the page.
//    That is precisely the wrong string Next spoke. We never fall back to it.
//
// ③ The title is correct 640–930ms BEFORE the content arrives. So announcing on
//    title-change alone would claim arrival while the skeleton is still up. The
//    rule is therefore: announce the new title, but DEFER while a loading
//    boundary is open — reusing #983's ref-count. Both messages flow through the
//    ONE region, so a navigation reads "กำลังโหลด…" then "โครงการ" and the two
//    can never overlap or race.
//
// ④ 127 of 135 page.tsx carry a static Thai metadata.title and the template is
//    `%s — PRC Ops`, so the suffix is stripped. It is per ROUTE, not per record
//    — 39 dynamic pages reuse one title for every record, which is why the
//    de-dupe is keyed on the pathname too. 8 pages set none
//    (/contacts measured: title "PRC Ops", h1 null) — those announce NOTHING
//    rather than "PRC Ops"; silence beats noise, and giving them titles is a
//    flagged follow-up rather than this unit's business.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RouteAnnouncer } from "@/components/features/chrome/route-announcer";
import {
  APP_TITLE_SUFFIX,
  ROUTE_LOADING_MESSAGE,
  announceArrival,
  beginRouteLoading,
  getRouteAnnouncement,
  pageNameFromTitle,
} from "@/lib/ui/route-announcement";

afterEach(cleanup);

describe("pageNameFromTitle — what a destination is called", () => {
  it("strips the `— PRC Ops` template suffix", () => {
    // metadata.title.template is "%s — PRC Ops", so every routed page's
    // document.title carries it. Repeating the app name on every navigation is
    // pure noise to someone listening.
    expect(pageNameFromTitle(`โครงการ${APP_TITLE_SUFFIX}`)).toBe("โครงการ");
    expect(pageNameFromTitle(`รายชื่อช่าง${APP_TITLE_SUFFIX}`)).toBe("รายชื่อช่าง");
  });

  it("returns nothing for a page that set no title of its own", () => {
    // Measured on /contacts: document.title is the bare default "PRC Ops" and
    // there is no <h1> at all. Announcing the app's name tells the listener
    // nothing about where they landed, so this stays silent.
    expect(pageNameFromTitle("PRC Ops")).toBe("");
    expect(pageNameFromTitle("")).toBe("");
    expect(pageNameFromTitle("   ")).toBe("");
  });

  it("survives the ~1–6ms window where Next has removed the title node", () => {
    // document.title is genuinely "" between the remove and the add. Reading it
    // then must produce silence, never a bogus announcement — this is the exact
    // state that makes the framework's own announcer speak the wrong thing.
    expect(pageNameFromTitle("")).toBe("");
  });

  it("returns nothing for a title that is ONLY the suffix", () => {
    // A page with `title: ""` renders " — PRC Ops". The leading trim() shortens
    // it below the suffix's own length, so a naive endsWith misses and the user
    // is read a dangling em dash followed by the app name.
    expect(pageNameFromTitle(APP_TITLE_SUFFIX)).toBe("");
    expect(pageNameFromTitle(`  ${APP_TITLE_SUFFIX}  `)).toBe("");
  });

  it("keeps a title that does not carry the suffix at all", () => {
    // Defensive: a page could set `title: { absolute: … }`. Announce it as-is
    // rather than dropping it.
    expect(pageNameFromTitle("อะไรสักอย่าง")).toBe("อะไรสักอย่าง");
  });
});

describe("announceArrival — the store half", () => {
  it("announces the destination when no boundary is open", () => {
    expect(getRouteAnnouncement().message).toBe("");

    announceArrival("โครงการ");
    expect(getRouteAnnouncement().message).toBe("โครงการ");

    // Leaves the region holding the destination: unlike the loading message
    // there is nothing to "finish", and a reader that arrives late still gets a
    // truthful answer to "where am I".
    announceArrival("รายชื่อช่าง");
    expect(getRouteAnnouncement().message).toBe("รายชื่อช่าง");
  });

  it("DEFERS while a loading boundary is open, then speaks on release", () => {
    // The measured 640–930ms gap. The title is already correct while the
    // skeleton is still on screen; announcing then would tell the user they had
    // arrived at a page that is not there yet.
    const release = beginRouteLoading();
    expect(getRouteAnnouncement().message).toBe(ROUTE_LOADING_MESSAGE);

    announceArrival("โครงการ");
    expect(
      getRouteAnnouncement().message,
      "arrival overwrote the loading message while the skeleton was still up — " +
        "the user is told they have arrived at a page that has not rendered",
    ).toBe(ROUTE_LOADING_MESSAGE);

    release();
    expect(getRouteAnnouncement().message).toBe("โครงการ");
  });

  it("keeps only the LAST destination when several resolve during one wait", () => {
    // A redirect chain, or a second tap mid-wait: the title can change more than
    // once behind one skeleton. The user arrives exactly once, at the last one.
    const release = beginRouteLoading();
    announceArrival("โครงการ");
    announceArrival("รายชื่อช่าง");
    release();

    expect(getRouteAnnouncement().message).toBe("รายชื่อช่าง");
  });

  it("does not resurrect a deferred arrival on a LATER, unrelated wait", () => {
    // Releasing must consume the pending arrival. Otherwise the next navigation
    // that opens a boundary would replay a stale destination name.
    const first = beginRouteLoading();
    announceArrival("โครงการ");
    first();
    expect(getRouteAnnouncement().message).toBe("โครงการ");

    const second = beginRouteLoading();
    expect(getRouteAnnouncement().message).toBe(ROUTE_LOADING_MESSAGE);
    second();
    expect(
      getRouteAnnouncement().message,
      "a stale destination replayed after an unrelated wait — the reader is told " +
        "they landed somewhere they left two navigations ago",
    ).toBe("");
  });

  it("ignores an empty destination — silence, not a blank announcement", () => {
    announceArrival("โครงการ");
    announceArrival("");
    expect(getRouteAnnouncement().message).toBe("โครงการ");
  });

  it("gives a REPEAT destination a fresh identity so it re-announces", () => {
    // Back-and-forth between two pages lands on the same name repeatedly; the
    // region only speaks on a DOM mutation.
    announceArrival("โครงการ");
    const first = getRouteAnnouncement().seq;
    announceArrival("โครงการ");
    expect(getRouteAnnouncement().seq).not.toBe(first);
  });
});

describe("<RouteAnnouncer> renders arrival through the SAME region", () => {
  beforeEach(() => {
    // Land the region on a known-empty state between cases.
    // Opening and closing a boundary with nothing pending is the only thing
    // that legitimately empties the region — announceArrival("") is a
    // non-announcement and is ignored, so it cannot serve as a reset.
    beginRouteLoading()();
  });

  it("reads the loading message then the destination, in that order", () => {
    render(<RouteAnnouncer />);
    const region = screen.getByRole("status");
    const seen: string[] = [];

    let release = (() => {}) as () => void;
    act(() => {
      release = beginRouteLoading();
    });
    seen.push(region.textContent ?? "");

    act(() => announceArrival("โครงการ"));
    seen.push(region.textContent ?? "");

    act(() => release());
    seen.push(region.textContent ?? "");

    expect(seen).toEqual([ROUTE_LOADING_MESSAGE, ROUTE_LOADING_MESSAGE, "โครงการ"]);
  });

  it("uses ONE region for both, so the two can never overlap", () => {
    render(<RouteAnnouncer />);
    expect(screen.getAllByRole("status")).toHaveLength(1);

    act(() => announceArrival("โครงการ"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("โครงการ");
  });
});

describe("<RouteAnnouncer> watches the document title for arrivals", () => {
  // The watcher lives in the region component on purpose: it is already the
  // one thing mounted once in the root layout, so folding this in adds no
  // second mount point to keep pinned and no second client component.
  beforeEach(() => {
    document.title = "หน้าหลัก" + APP_TITLE_SUFFIX;
    // Opening and closing a boundary with nothing pending is the only thing
    // that legitimately empties the region — announceArrival("") is a
    // non-announcement and is ignored, so it cannot serve as a reset.
    beginRouteLoading()();
  });

  it("says NOTHING for the title already present when it mounts", async () => {
    // A full page load is announced by the reader itself, and the title is in
    // the streamed HTML — speaking here would make every cold start chatty.
    render(<RouteAnnouncer />);
    await act(async () => {});

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("announces the destination when the title CHANGES", async () => {
    render(<RouteAnnouncer />);
    await act(async () => {});

    await act(async () => {
      document.title = "โครงการ" + APP_TITLE_SUFFIX;
    });

    expect(
      screen.getByRole("status").textContent,
      "the title changed and nothing was announced — arrival is still silent",
    ).toBe("โครงการ");
  });

  it("survives Next REPLACING the title node instead of editing its text", async () => {
    // The measured mechanism: <title> is removed and a new one added, with
    // document.title empty in between. A watcher bound to the original node's
    // text would go deaf after the first navigation; one bound to <head> does
    // not. This is also the ~1–6ms window that must not produce an
    // announcement of its own.
    render(<RouteAnnouncer />);
    await act(async () => {});

    await act(async () => {
      document.head.querySelector("title")?.remove();
    });
    expect(
      screen.getByRole("status").textContent,
      "announced something during the gap where Next has no title in the head",
    ).toBe("");

    await act(async () => {
      const t = document.createElement("title");
      t.textContent = "รายชื่อช่าง" + APP_TITLE_SUFFIX;
      document.head.appendChild(t);
    });

    expect(screen.getByRole("status").textContent).toBe("รายชื่อช่าง");
  });

  it("stays silent when the title is re-set to the SAME page", async () => {
    // Re-rendering or a refresh must not re-announce a page the user never left.
    render(<RouteAnnouncer />);
    await act(async () => {});

    await act(async () => {
      document.title = "หน้าหลัก" + APP_TITLE_SUFFIX;
    });

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("announces a DIFFERENT RECORD under the same route title", async () => {
    // The app's most frequent navigation, and a name-only de-dupe kills it
    // outright. 39 dynamic-segment pages carry ONE static title for every
    // record — /projects/[projectId]/work-packages/[workPackageId] is
    // "รูปถ่ายงาน" for every work package, and WP→WP is what a site admin does
    // all day. Keying only on the title means the second WP is treated as a
    // repeat, nothing is announced, and the boundary's release then publishes
    // "" — so the user hears "กำลังโหลด…" and then silence, permanently.
    window.history.pushState({}, "", "/projects/p1/work-packages/a");
    document.title = "รูปถ่ายงาน" + APP_TITLE_SUFFIX;

    render(<RouteAnnouncer />);
    await act(async () => {});

    await act(async () => {
      window.history.pushState({}, "", "/projects/p1/work-packages/b");
      document.head.querySelector("title")?.remove();
    });
    await act(async () => {
      const t = document.createElement("title");
      t.textContent = "รูปถ่ายงาน" + APP_TITLE_SUFFIX;
      document.head.appendChild(t);
    });

    expect(
      screen.getByRole("status").textContent,
      "a different record under the same route title announced nothing — the " +
        "de-dupe is keyed on the page NAME instead of the navigation",
    ).toBe("รูปถ่ายงาน");
  });

  it("stays silent when the node is REPLACED with the same page's title", async () => {
    // The case above cannot see the real mechanism: assigning document.title
    // edits the existing text node, while Next removes the node and adds a new
    // one — so the watcher passes through an empty title in between. A
    // router.refresh() replaces the node with IDENTICAL text, and if that empty
    // moment is allowed to become the baseline, the re-add reads as a change and
    // announces an arrival the user never made. (A mutation proved the plain
    // assignment above cannot catch it.)
    render(<RouteAnnouncer />);
    await act(async () => {});

    // The remove and the add MUST be separate flushes. MutationObserver
    // batches into one microtask, so doing both inside a single act() means the
    // callback only ever sees the finished state and the empty moment never
    // happens — a mutation proved that version could not catch this either. The
    // real thing is two events ~27ms apart.
    await act(async () => {
      document.head.querySelector("title")?.remove();
    });
    await act(async () => {
      const t = document.createElement("title");
      t.textContent = "หน้าหลัก" + APP_TITLE_SUFFIX;
      document.head.appendChild(t);
    });

    expect(
      screen.getByRole("status").textContent,
      "announced an arrival for the page the user is already on — the title node " +
        "was replaced with the same text and the empty gap was treated as a change",
    ).toBe("");
  });

  it("stays silent for a page that set no title", async () => {
    render(<RouteAnnouncer />);
    await act(async () => {});

    await act(async () => {
      document.title = "PRC Ops";
    });

    expect(
      screen.getByRole("status").textContent,
      "announced the bare app name — tells the listener nothing about where they landed",
    ).toBe("");
  });

  it("defers to the loading boundary: skeleton first, destination on release", async () => {
    // End-to-end through the real component, in the real order a navigation
    // produces: the title lands ~640–930ms before the content does.
    render(<RouteAnnouncer />);
    await act(async () => {});
    const region = screen.getByRole("status");

    let release = (() => {}) as () => void;
    await act(async () => {
      release = beginRouteLoading();
    });
    await act(async () => {
      document.title = "โครงการ" + APP_TITLE_SUFFIX;
    });
    expect(region.textContent).toBe(ROUTE_LOADING_MESSAGE);

    await act(async () => release());
    expect(region.textContent).toBe("โครงการ");
  });

  it("stops watching when unmounted", async () => {
    const { unmount } = render(<RouteAnnouncer />);
    await act(async () => {});
    unmount();

    await act(async () => {
      document.title = "โครงการ" + APP_TITLE_SUFFIX;
    });

    // Nothing to assert on screen; the store must not have moved either.
    expect(getRouteAnnouncement().message).toBe("");
  });
});
