// Spec 277 — display the WP's category LETTER in place of the meaningless "WP"
// in its code (งานระบบไฟฟ้า WP-12 → E-12). Pure and DISPLAY-ONLY: the stored
// work_packages.code is never changed. A leading "WP" or "WP-" (any case) is
// swapped for `${letter}-`; codes without that prefix, or with no category
// letter, pass through unchanged.

import { workCategoryIdentity } from "@/lib/work-categories/identity";

export function formatWpCode(code: string, letter: string | null | undefined): string {
  if (!letter) return code;
  return code.replace(/^WP-?/i, `${letter}-`);
}

// Spec 301 U3 — the TEXT-ONLY letter-code for surfaces that cannot render the
// <WpCategoryCode> component (native <option> / <optgroup> labels carry no
// markup): resolve the letter from the reconciled W0x code and swap. Same
// graceful degrade — no/unknown category → the raw code.
export function wpDisplayCode(code: string, categoryCode: string | null | undefined): string {
  return formatWpCode(code, workCategoryIdentity(categoryCode)?.letter ?? null);
}
