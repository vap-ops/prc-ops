// Spec 386 U5 — per-person "can we reach them?" chip on the role roster.
//
// Four states, and the third one is the point: `unknown` is styled as NEUTRAL,
// never as a warning. `line_oa_friend` is refreshed only at LINE login, so a
// null flag means nobody has checked — colouring it like `none` would send the
// operator chasing people who may already be fine.

import type { Reachability } from "@/lib/notifications/reachability";
import { REACH_LINE, REACH_NONE, REACH_TELEGRAM, REACH_UNKNOWN } from "@/lib/i18n/labels";

const CHIP = "text-meta shrink-0 rounded-full px-2 py-0.5 font-medium";

const STYLE: Record<Reachability, string> = {
  telegram: "bg-done-soft text-done-strong",
  line: "bg-done-soft text-done-strong",
  // neutral on purpose — unknown is not a problem, it is an absence of data
  unknown: "bg-sunk text-ink-secondary",
  none: "bg-attn-soft text-attn-ink",
};

const LABEL: Record<Reachability, string> = {
  telegram: REACH_TELEGRAM,
  line: REACH_LINE,
  unknown: REACH_UNKNOWN,
  none: REACH_NONE,
};

export function ReachabilityChip({ reach }: { reach: Reachability }) {
  return (
    <span data-testid={`reach-${reach}`} className={`${CHIP} ${STYLE[reach]}`}>
      {LABEL[reach]}
    </span>
  );
}
