// Canonical UI class constants (spec 63) — the PAGE_MAX_W idea applied
// to the rest of the chrome: one source per pattern, consumers import.
// Constants (not components) because the same classes land on
// <button>, <label>, and <Link> alike. Values are byte-identical to the
// hand-copied strings they replaced — adopting them is a no-op render.
//
// Hand-rolling a copy of any of these is a review reject
// (ui-conventions.md §5/§7).

/** Slate-900 primary action fill (spec 40). */
export const BUTTON_PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500";

/** White outline sibling of BUTTON_PRIMARY. */
export const BUTTON_SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-xs transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:text-zinc-500";

/** 44px white chip for header icon affordances (back/gear/reports). */
export const ICON_CHIP =
  "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/** ICON_CHIP with muted ink for secondary header actions. */
export const ICON_CHIP_MUTED =
  "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/** Inline form/action error strip — pair with role="alert". */
export const INLINE_ERROR =
  "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900";

/** Standard white card (spec 38 class map). */
export const CARD = "rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm";
