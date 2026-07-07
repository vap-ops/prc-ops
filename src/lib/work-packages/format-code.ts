// Spec 277 — display the WP's category LETTER in place of the meaningless "WP"
// in its code (งานระบบไฟฟ้า WP-12 → E-12). Pure and DISPLAY-ONLY: the stored
// work_packages.code is never changed. A leading "WP" or "WP-" (any case) is
// swapped for `${letter}-`; codes without that prefix, or with no category
// letter, pass through unchanged.
export function formatWpCode(code: string, letter: string | null | undefined): string {
  if (!letter) return code;
  return code.replace(/^WP-?/i, `${letter}-`);
}
