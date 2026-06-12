// Spec 46 C7 — labor days are Asia/Bangkok calendar dates, never UTC.
// The implementation moved to the shared src/lib/dates.ts in spec 65;
// this re-export keeps every pre-spec-65 import site compiling.

export { bangkokTodayIso } from "@/lib/dates";
