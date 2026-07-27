// Spec 365 — the three action-button token classes team-map-view.tsx and
// plan-tab.tsx both render (a full-width sheet row, a pill-shaped tier
// action). Shared here so the two component files never hold two copies of
// the same class string.
//
// Colour-free base — some callers swap the ink per selected state, and a
// `text-action` baked into TIER_ACTION would fight it in the generated
// stylesheet (see tests/unit/ui-class-contracts.test.tsx).
export const TIER_ACTION_BASE =
  "border-edge bg-card inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium";
export const TIER_ACTION = `${TIER_ACTION_BASE} text-action`;
export const SHEET_ACTION =
  "border-edge text-ink flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm";
