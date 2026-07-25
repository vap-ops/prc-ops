// Spec 321 U7 — the ONE waiting banner shown while an approved-tier profile
// change (bank / identity) is pending. One uniform attention treatment + copy
// for every audience, replacing the four near-identical inline banners that had
// drifted in markup (S16). The copy comes from the labels SSOT; the caller
// passes only the message. `className` sets the container so it works both as a
// standalone card (default — identity / user-bank / my-info) and nested inside a
// section's read card as an inset (ProfileBankSection).
//
// Pure presentational (no state / handlers) → no 'use client', so it renders in
// both Server Components (the my-info page) and Client Components (the forms).

import type { ReactNode } from "react";
import { CARD_LAYOUT } from "@/lib/ui/classes";

export function PendingChangeNotice({
  children,
  // CARD_LAYOUT, not CARD: the wrapper below supplies the amber pair, and
  // CARD's own bg-card/border-edge would outrank it in the stylesheet.
  className = CARD_LAYOUT,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${className} border-attn bg-attn-soft border-l-4`}>
      <p className="text-attn-ink text-sm font-medium">{children}</p>
    </div>
  );
}
