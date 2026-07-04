// spec 263 follow-up — the login return-path guard.
//
// A technician who taps /register/technician while logged out is bounced to
// /login → LINE login → callback. Without a return path a fresh `visitor`
// lands on /coming-soon, stranded. We thread an OPTIONAL `next` through the
// login round-trip (register page → /login → /auth/line/start cookie →
// callback) so they come back.
//
// `next` is attacker-influenceable (it starts life as a query param), so it
// is an OPEN-REDIRECT vector: it MUST be re-validated at EVERY point it is
// consumed, never trusted from a prior hop. safeNextPath is that single
// validator — a pure function, no I/O — and returns the path only if it is a
// safe, relative, same-origin path; otherwise null (callers fall back to the
// role home, i.e. today's behavior).
//
// ACCEPT rule (deliberately strict — allowlist, not denylist):
//   - a single leading "/"  (relative to our own origin)
//   - NOT "//" or "/\" or any backslash  (protocol-relative → external)
//   - no scheme, no "@" (userinfo smuggling)
//   - no control characters
//   - no percent-encoding that could decode to a slash/backslash
// Anything else → null.

const ENCODED_SLASH = /%2f|%5c/i;

// True if the string holds any ASCII control character (0x00–0x1f or 0x7f).
// Written as a code-point scan, not a regex literal, so the source file never
// contains raw control bytes.
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  // No trimming: a leading space means it is not a clean "/path", reject it.
  if (raw.length === 0) return null;

  // Must be a site-relative path: exactly one leading slash.
  if (raw[0] !== "/") return null;
  // "//x" (protocol-relative) and "/\x" both resolve to an external origin.
  if (raw[1] === "/" || raw[1] === "\\") return null;

  // A backslash anywhere is never valid in a same-origin path and some
  // parsers treat it as "/", so reject the whole value.
  if (raw.includes("\\")) return null;

  // Control characters (incl. \n, \t, NUL) — browsers strip some of these
  // before parsing a URL, which can change the effective target. Reject.
  if (hasControlChar(raw)) return null;

  // "@" anywhere lets "/@evil.com" or "/x@evil.com" read as userinfo when a
  // downstream consumer is sloppy about origin. Not needed for our paths.
  if (raw.includes("@")) return null;

  // Percent-encoded slash/backslash could decode to "//"/"/\" downstream.
  // %2F, %2f, %5C, %5c. Reject any encoded slash/backslash outright.
  if (ENCODED_SLASH.test(raw)) return null;

  // Final defensive parse against a fixed placeholder origin: the resolved
  // URL must stay on that origin. Anything that escapes it (a scheme we
  // missed, a normalization quirk) is rejected.
  let resolved: URL;
  try {
    resolved = new URL(raw, "https://prc-ops.invalid");
  } catch {
    return null;
  }
  if (resolved.origin !== "https://prc-ops.invalid") return null;

  // Return the original relative form (path + query + hash), not the absolute
  // URL — callers redirect to a same-origin relative path.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
