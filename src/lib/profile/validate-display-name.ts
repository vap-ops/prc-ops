// Pure validator mirroring the rules in public.update_my_display_name
// (feature spec 05, ADR 0017). The SQL function is the security
// authority — this validator is UX-only, used by the form to surface
// inline errors before the round-trip.

export type ValidateResult = { ok: true; value: string } | { ok: false; error: string };

const MAX_LENGTH = 80;

export function validateDisplayName(input: string): ValidateResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Display name can't be empty." };
  }
  if (trimmed.length > MAX_LENGTH) {
    return {
      ok: false,
      error: `Display name must be ${MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, value: trimmed };
}
