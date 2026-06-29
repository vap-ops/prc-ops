// Spec 214 — product code validation. A code is either unset (empty) or exactly
// six ASCII digits (main 2 + sub 2 + sequence 2). Single-sourced so the form and
// the server action validate identically; the DB CHECK + RPC guard are the floor.

export const PRODUCT_CODE_RE = /^[0-9]{6}$/;

/** True when the (trimmed) code is empty OR exactly six digits. */
export function isValidProductCode(code: string): boolean {
  const c = code.trim();
  return c === "" || PRODUCT_CODE_RE.test(c);
}

// Spec 221 U4 — the product code is COMPOSED from the taxonomy, not free-typed:
// digits 1-2 = the main category's 2-digit code, digits 3-4 = the chosen
// subcategory's 2-digit code (when one is chosen). The user types only the
// trailing "sequence". Single-sourced so the form composes consistently and the
// prefix always matches the chosen taxonomy.

/** Length of the sequence tail the user types: 4 with no subcategory (the prefix
 *  is the 2-digit category code), 2 with a subcategory (the prefix is 4 digits). */
export function productCodeTailLength(categoryCode: string, subcategoryCode: string): number {
  return 6 - (categoryCode.length + subcategoryCode.length);
}

/** Compose the stored 6-digit product code from the taxonomy prefix + the typed
 *  tail. A blank tail yields "" — the code is optional (spec 214). */
export function composeProductCode(
  categoryCode: string,
  subcategoryCode: string,
  tail: string,
): string {
  const t = tail.trim();
  if (t === "") return "";
  return `${categoryCode}${subcategoryCode}${t}`;
}
