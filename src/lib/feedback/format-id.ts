// SSOT for rendering the human feedback running number (FB-0007). Mirrors the
// PR/PO formatter (src/lib/purchasing/format-id.ts): zero-padded to 4 so the
// SAME record never renders two ways across the kanban / detail / reporter list.
// null/undefined → 0, mirroring the PR/PO formatter. Pure (no React / no DB) →
// unit-tested.

export function formatFeedbackNumber(feedbackNumber: number | null | undefined): string {
  return `FB-${String(feedbackNumber ?? 0).padStart(4, "0")}`;
}
