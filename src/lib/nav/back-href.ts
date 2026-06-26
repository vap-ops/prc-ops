// Referrer-aware back chip (sitemap review, 2026-06-26).
//
// A detail page (DetailHeader) renders a single "up" back chip with a hardcoded
// hierarchical parent. That's correct for a page with one parent, but a page
// reached from several surfaces — a work package opened from /sa, the schedule,
// a purchase request, or a งวด; a feedback report opened from the operator
// review kanban vs the reporter's own list — would back to the SAME fixed page
// regardless of where you came from, i.e. "jump to a weird page".
//
// The mechanism: a link INTO such a page records its own path via withBackFrom()
// (a ?from=<path> query param); the page resolves its back chip with
// safeBackHref(), which returns that referrer when it is a safe same-origin app
// path and otherwise falls back to the hierarchical parent (direct loads, PWA
// cold-starts, or a forged value). The back arrow is icon-only, so nothing in
// the visible UI changes — only the destination follows the trail.

// A path is rejected if it contains any space or control character (code <= 0x20)
// — these are the whitespace/control tricks used to slip past a naive prefix
// check; legitimate printable paths (including hyphens, slashes) are unaffected.
function hasWhitespaceOrControl(s: string): boolean {
  for (const ch of s) {
    if (ch.charCodeAt(0) <= 0x20) return true;
  }
  return false;
}

/**
 * Resolve a detail page's back-chip href from an optional `?from` referrer.
 * Returns the referrer only when it is a root-relative, same-origin app path;
 * any absent / off-app / malformed value yields the hierarchical `fallback`, so
 * back can never navigate off the application (no open-redirect surface).
 */
export function safeBackHref(from: string | undefined, fallback: string): string {
  if (!from) return fallback;
  const safe =
    from.startsWith("/") && // root-relative
    !from.startsWith("//") && // not protocol-relative (//host)
    !from.includes("\\") && // no backslash tricks (/\\host)
    !from.includes("://") && // no embedded scheme
    !hasWhitespaceOrControl(from);
  return safe ? from : fallback;
}

/**
 * Build a link into a detail page that records the caller's own path as a
 * `?from` param, so the page's back chip can return there. The param is inserted
 * before any `#hash` (preserving deep-links like #wp-photos) and joined with `&`
 * when the href already carries a query.
 */
export function withBackFrom(href: string, fromPath: string): string {
  const hashIndex = href.indexOf("#");
  const base = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}from=${encodeURIComponent(fromPath)}${hash}`;
}
