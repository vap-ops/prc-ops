import {
  ACCOUNTING_HUB_LABEL,
  ATTENDANCE_AUDIT_LABEL,
  ATTENDANCE_CALENDAR_LABEL,
  PROCUREMENT_HUB_LABEL,
  TEAM_HUB_LABEL,
} from "@/lib/i18n/labels";

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
export function safeBackHref(rawFrom: string | string[] | undefined, fallback: string): string {
  // A crafted duplicate param (?from=/a&from=/b) reaches Next pages as
  // string[] — coalesce to the first entry (then validate) instead of throwing.
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
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

// Spec 358 → 397 U2 — the attendance report's back-chip LABEL.
//
// The chip is icon-only, so this string is what a screen reader announces: it is
// a factual claim about where back goes. It began as a two-arm ternary on the
// page (accounting → บัญชี, else ทีมงาน), which was true while /team and
// /accounting were the only parents. Spec 397 U2 adds /procurement as a third,
// and an unlabelled third parent does not fail anything — it just announces the
// wrong destination. So the resolution moved here, beside safeBackHref, where a
// future parent is a one-line addition with a test rather than a growing ternary.
//
// Each prefix is matched at a SEGMENT boundary, not with a bare startsWith: a
// future top-level `/accounting-close` or `/procurement-review` would otherwise
// inherit its neighbour's name silently. (Fresh-eyes catch — there is no such
// route today, so this is the shape being wrong rather than the output.)
//
// The labels are matched against the RESOLVED href (safeBackHref's output), not
// the raw `?from`. Note what that does and does not buy: safeBackHref rejects
// only OFF-APP values, so any root-relative string still passes through, and a
// hand-crafted `?from=/accounting/../procurement` can still be labelled บัญชี
// while the browser lands on /procurement. Self-inflicted, no privilege crossed
// — but the honest statement is "the label names the resolved href's first
// segment", not "the label can never disagree with the link".
// Spec 400 U6a — the fix page's most common parent is the report itself, which
// the report never had to name before (it never links to itself). Order does
// not matter (the prefixes are disjoint), so this is appended rather than
// sorted specially.
// Spec 400 U6b — the spec-374 per-worker calendar became a FOURTH parent of the
// fix page (its day cells link there). Without this arm the chip fell through to
// ทีมงาน while navigating to `/workers/<id>/attendance`, and the chip is
// icon-only, so that label IS what a screen reader announces — the exact
// disagreement the note above says the labels exist to prevent.
const ATTENDANCE_BACK_LABELS: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ["/accounting", ACCOUNTING_HUB_LABEL],
  ["/procurement", PROCUREMENT_HUB_LABEL],
  ["/team/attendance", ATTENDANCE_AUDIT_LABEL],
  ["/workers", ATTENDANCE_CALENDAR_LABEL],
];

function isUnder(href: string, prefix: string): boolean {
  if (href === prefix) return true;
  const next = href.charAt(prefix.length);
  return href.startsWith(prefix) && (next === "/" || next === "?" || next === "#");
}

/**
 * Name the attendance report's back destination. Falls back to the hierarchical
 * parent's own name (ทีมงาน) for any href nobody has labelled — which is also
 * where `safeBackHref` sends a direct load or an off-app `?from`, so an
 * unlabelled parent degrades to the truthful default rather than to silence.
 */
export function attendanceBackLabel(backHref: string): string {
  const match = ATTENDANCE_BACK_LABELS.find(([prefix]) => isUnder(backHref, prefix));
  return match ? match[1] : TEAM_HUB_LABEL;
}
