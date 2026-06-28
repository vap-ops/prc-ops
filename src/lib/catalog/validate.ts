// Spec 214 — product code validation. A code is either unset (empty) or exactly
// six ASCII digits (main 2 + sub 2 + sequence 2). Single-sourced so the form and
// the server action validate identically; the DB CHECK + RPC guard are the floor.

export const PRODUCT_CODE_RE = /^[0-9]{6}$/;

/** True when the (trimmed) code is empty OR exactly six digits. */
export function isValidProductCode(code: string): boolean {
  const c = code.trim();
  return c === "" || PRODUCT_CODE_RE.test(c);
}
