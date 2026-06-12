// Shared phase display list + latest-timestamp helper (spec 65) —
// previously duplicated verbatim between the SA and PM WP detail pages.
// Pure; safe for server and client imports.

import { PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";
import type { PhotoPhase } from "@/lib/db/enums";

export const PHASES: ReadonlyArray<{ phase: PhotoPhase; label: string }> = [
  // เตรียมงาน is the display label for the `before` enum value —
  // equipment and raw-material staging (spec 10). The DB enum is untouched.
  { phase: "before", label: PHOTO_PHASE_LABEL.before },
  { phase: "during", label: PHOTO_PHASE_LABEL.during },
  { phase: "after", label: PHOTO_PHASE_LABEL.after },
];

// Spec 54: tile overlay = capture time (client clock when known, else
// upload time); sub-line = latest upload time. ISO strings compare
// lexicographically, so > is a correct max.
export function latestCreatedAt(photos: ReadonlyArray<{ created_at: string }>): string | null {
  return photos.reduce<string | null>(
    (acc, p) => (acc === null || p.created_at > acc ? p.created_at : acc),
    null,
  );
}
