// Canonical UUID validation (spec 65). Previously this regex was hand-
// copied as a private const into 11 modules; this is the single home.
// Pure — safe to import from server actions and client components alike.
// photos/path.ts re-exports isValidUuid so pre-spec-65 importers keep
// working.

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}
