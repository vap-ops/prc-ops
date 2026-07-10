// Sitemap review (2026-06-26): a detail page's back chip is a hardcoded
// hierarchical "up" link, which jumps to a "weird page" when the page is reached
// from several surfaces (e.g. a WP opened from /sa, the schedule, or a purchase
// request; a feedback report opened from the review kanban vs the reporter's own
// list). The fix: callers record their own path with withBackFrom(); the detail
// page resolves the back chip with safeBackHref(), falling back to the
// hierarchical parent when there is no referrer or it isn't a safe app path.
// These two pure helpers carry the whole mechanism — test them first (RED).

import { describe, it, expect } from "vitest";
import { safeBackHref, withBackFrom } from "@/lib/nav/back-href";

describe("safeBackHref", () => {
  const FALLBACK = "/projects/p1";

  it("falls back when there is no referrer", () => {
    expect(safeBackHref(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeBackHref("", FALLBACK)).toBe(FALLBACK);
  });

  it("returns a valid same-origin app path", () => {
    expect(safeBackHref("/sa", FALLBACK)).toBe("/sa");
    expect(safeBackHref("/projects/abc/schedule", FALLBACK)).toBe("/projects/abc/schedule");
    expect(safeBackHref("/requests/req-1", FALLBACK)).toBe("/requests/req-1");
    expect(safeBackHref("/feedback/review", FALLBACK)).toBe("/feedback/review");
  });

  it("preserves a query string on the referrer", () => {
    expect(safeBackHref("/accounting?from=2026-06-01&to=2026-06-30", FALLBACK)).toBe(
      "/accounting?from=2026-06-01&to=2026-06-30",
    );
  });

  // Back-nav sweep 2026-07-11 review: a crafted duplicate param
  // (?from=/a&from=/b) reaches the page as string[], which used to TypeError
  // (500). The helper takes the first entry — same validation applies.
  it("coalesces a duplicate-param array to its first entry", () => {
    expect(safeBackHref(["/sa", "/evil"], FALLBACK)).toBe("/sa");
    expect(safeBackHref(["//evil.com", "/sa"], FALLBACK)).toBe(FALLBACK);
    expect(safeBackHref([], FALLBACK)).toBe(FALLBACK);
  });

  it("rejects off-app and malicious values, falling back", () => {
    expect(safeBackHref("//evil.com", FALLBACK)).toBe(FALLBACK); // protocol-relative
    expect(safeBackHref("https://evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeBackHref("http://evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeBackHref("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
    expect(safeBackHref("/\\evil.com", FALLBACK)).toBe(FALLBACK); // backslash trick
    expect(safeBackHref("/foo\\bar", FALLBACK)).toBe(FALLBACK);
    expect(safeBackHref("  /sa", FALLBACK)).toBe(FALLBACK); // not root-relative
    expect(safeBackHref("/sa\nx", FALLBACK)).toBe(FALLBACK); // control char
    expect(safeBackHref("sa", FALLBACK)).toBe(FALLBACK); // relative, no leading slash
  });
});

describe("withBackFrom", () => {
  it("appends the referrer as an encoded ?from param", () => {
    expect(withBackFrom("/feedback/123", "/feedback/review")).toBe(
      "/feedback/123?from=%2Ffeedback%2Freview",
    );
  });

  it("inserts the param before a hash, preserving the deep-link", () => {
    expect(withBackFrom("/projects/p/work-packages/w#wp-photos", "/sa")).toBe(
      "/projects/p/work-packages/w?from=%2Fsa#wp-photos",
    );
  });

  it("uses & when the href already has a query", () => {
    expect(withBackFrom("/a?b=1", "/sa")).toBe("/a?b=1&from=%2Fsa");
    expect(withBackFrom("/a?b=1#h", "/sa")).toBe("/a?b=1&from=%2Fsa#h");
  });

  it("round-trips: the encoded ?from decodes back to a path safeBackHref accepts", () => {
    const built = withBackFrom("/projects/p/work-packages/w", "/projects/p/schedule");
    const param = new URL(built, "https://x.test").searchParams.get("from");
    expect(param).toBe("/projects/p/schedule");
    expect(safeBackHref(param ?? undefined, "/projects/p")).toBe("/projects/p/schedule");
  });
});
