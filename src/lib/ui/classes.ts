// Canonical UI class constants — Field-First (Unit 1, revised).
//
// Components consume these; the constants consume token-generated
// utilities (bg-card, text-ink, rounded-control, shadow-card,
// text-body, …). A theme change is ONE file (globals.css). These
// strings carry NO raw color literals.
//
// Every value is byte-pinned in tests/unit/ui-classes-spec65.test.ts
// — those pins are UPDATED in this unit (test path (b): the design
// changes output, so the pins follow the design). Hand-rolling a copy
// of any shared primitive is a review reject (ui-conventions §5/§7).

/** Slate-900 neutral primary fill (spec 40), token-driven. */
export const BUTTON_PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-control bg-fill px-4 text-body font-semibold text-on-fill shadow-card transition-colors hover:bg-fill-press focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-edge disabled:text-ink-muted";

/** White outline sibling of BUTTON_PRIMARY. */
export const BUTTON_SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-control border border-edge bg-card px-4 text-body font-semibold text-ink shadow-input transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:text-ink-muted";

/**
 * Field-First HERO action — the full-width amber capture bar. 64px so a
 * gloved thumb cannot miss it; 2px amber underside reads as a physical
 * key. The single most important control in the app.
 */
export const BUTTON_CAPTURE =
  "inline-flex h-16 w-full items-center justify-center gap-3 rounded-card bg-attn text-lg font-extrabold text-on-attn shadow-card transition-[transform,background-color] hover:bg-attn-press hover:text-on-fill focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-0.5";

/** 44px white chip for header icon affordances (back/gear/reports). */
export const ICON_CHIP =
  "inline-flex h-11 w-11 items-center justify-center rounded-control border border-edge bg-card text-ink shadow-card transition-colors hover:bg-sunk active:bg-sunk active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/** ICON_CHIP with muted ink for secondary header actions. */
export const ICON_CHIP_MUTED =
  "inline-flex h-11 w-11 items-center justify-center rounded-control border border-edge bg-card text-ink-secondary shadow-card transition-colors hover:bg-sunk hover:text-ink active:bg-sunk active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/** Inline form/action error strip — pair with role="alert". */
export const INLINE_ERROR =
  "rounded-md border border-danger-edge bg-danger-soft px-3 py-2 text-meta text-danger-ink";

/** Standard white card — defined corner + real elevation, hairline kept. */
export const CARD = "rounded-card border border-edge bg-card px-4 py-3 shadow-card";

/** Zone/section heading h2. */
export const SECTION_HEADING = "mb-3 text-section font-semibold text-ink";

/**
 * Detail-page subject h1 (WP name, request item) — full wrap, never
 * truncate (spec 54/57). Promoted to the `display` tier: WP identity is
 * the page's unmistakable nameplate. `leading-snug` kept explicit — a
 * Thai-only app needs the override or wrapped tone marks crowd (spec 67;
 * design-doctrine pins a `leading-` class on this constant).
 */
export const DETAIL_TITLE = "text-display leading-snug font-extrabold tracking-tight break-words";

/** Standard h-11 text input. Field border = edge-strong (WCAG 1.4.11). */
export const FIELD_INPUT =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-3 text-body text-ink shadow-input placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/** Standard h-11 select (px-2 sibling of FIELD_INPUT). */
export const FIELD_SELECT =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-body text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/** Stacked label+field input used by the labor components (py-2, mt-1). */
export const FIELD_STACKED =
  "mt-1 w-full rounded-control border border-edge-strong bg-card px-3 py-2 text-body text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/** min-h-11 primary fill, the labor-feature compact pair. */
export const BUTTON_PRIMARY_COMPACT =
  "inline-flex min-h-11 items-center justify-center rounded-control bg-fill px-4 py-2 text-body font-medium text-on-fill shadow-input transition-colors hover:bg-fill-press active:translate-y-px disabled:opacity-50";

/** min-h-11 outline sibling of BUTTON_PRIMARY_COMPACT. */
export const BUTTON_SECONDARY_COMPACT =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-edge bg-card px-4 py-2 text-body font-medium text-ink-secondary transition-colors hover:bg-sunk";

/** Muted secondary used by the photo uploaders. */
export const BUTTON_SECONDARY_MUTED =
  "inline-flex h-11 items-center justify-center rounded-control border border-edge bg-card px-3 text-body font-medium text-ink shadow-input transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-60";

/** Borderless inline alert text — pair with role="alert". */
export const INLINE_ALERT_TEXT = "text-meta font-medium text-danger";

/** Full-width error banner (login surfaces) — pair with role="alert". */
export const BANNER_ERROR =
  "rounded border border-danger-edge bg-danger-soft px-4 py-3 text-body text-danger-ink";

/**
 * RESERVED critical-path badge (Field-First). Driven by `isCritical`
 * (the future critical-path engine — false for every WP today, so this
 * renders nowhere yet). Pinned now so the slot is style-stable when the
 * engine lights it. High-vis red fill, white ink — readable at arm's
 * length in glare.
 */
export const CRITICAL_BADGE =
  "inline-flex items-center gap-1 rounded-full border border-danger-ink bg-danger px-2 py-0.5 text-meta font-extrabold text-on-fill";

// ---------------------------------------------------------------------------
// Spec 76 — toast colour trios. emerald is the sanctioned positive hue
// (NEVER green-* — design-doctrine test). Token-rewired.
// ---------------------------------------------------------------------------

/** Success toast colours — the done (emerald) trio. */
export const TOAST_SUCCESS = "border-done bg-done/10 text-done-strong";

/** Error toast colours — the danger (red) trio. */
export const TOAST_ERROR = "border-danger-edge bg-danger-soft text-danger-ink";
