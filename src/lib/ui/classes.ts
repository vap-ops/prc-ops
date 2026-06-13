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

// ---------------------------------------------------------------------------
// Spec 65 additions. Every value below is byte-identical to the hand-rolled
// string it replaced (tests/unit/ui-classes-spec65.test.ts pins each one).
// ---------------------------------------------------------------------------

/** Zone/section heading h2 (ui-conventions §5). */
export const SECTION_HEADING = "mb-3 text-base font-semibold text-zinc-900";

/**
 * Detail-page subject h1 (spec 54/57 — full wrap, never truncate).
 * Spec 67: `leading-snug` — a Thai-only app needs explicit leading on a
 * wrapping heading, or the next line's stacked tone marks crowd the line
 * above (text-2xl default ≈1.33 is Latin-tuned).
 */
export const DETAIL_TITLE = "text-2xl leading-snug font-bold tracking-tight break-words";

/** Standard h-11 text input (forms outside the labor zone). */
export const FIELD_INPUT =
  "h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/** Standard h-11 select (px-2 sibling of FIELD_INPUT). */
export const FIELD_SELECT =
  "h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-2 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/** Stacked label+field input used by the labor components (py-2, mt-1). */
export const FIELD_STACKED =
  "mt-1 w-full rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/** min-h-11 primary fill, the labor-feature compact pair (vs BUTTON_PRIMARY's h-11). */
export const BUTTON_PRIMARY_COMPACT =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-slate-800 active:translate-y-px disabled:opacity-50";

/** min-h-11 outline sibling of BUTTON_PRIMARY_COMPACT. */
export const BUTTON_SECONDARY_COMPACT =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50";

/** Muted secondary used by the photo uploaders (hover zinc-100, opacity disable). */
export const BUTTON_SECONDARY_MUTED =
  "inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 shadow-xs transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60";

/** Borderless inline alert text — pair with role="alert" (INLINE_ERROR's light sibling). */
export const INLINE_ALERT_TEXT = "text-xs font-medium text-red-700";

/** Full-width error banner (login surfaces) — pair with role="alert". */
export const BANNER_ERROR =
  "rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900";
