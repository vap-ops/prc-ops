# Spec 21 — Urgency as a colored segmented control

**Origin:** operator chat 2026-06-11 — "how about radio button for urgency, can be colored as well."

## Problem

The purchase-request form's ความเร่งด่วน field is a native `<select>`. With only
3 values it costs two taps (open picker, choose) and hides the urgency levels
until opened. The request list already communicates urgency with solid colored
status pills (spec 20); the create form should speak the same visual language.

## Change

In `src/components/features/purchase-request-form.tsx`, replace the priority
`<select>` with a **radio group styled as a segmented row of buttons**:

- Semantics: a `fieldset` (legend ความเร่งด่วน) containing 3 native
  `<input type="radio" name="pr-priority">` + label pairs — keyboard and
  screen-reader behavior comes from the platform, no ARIA re-implementation.
  The radio input is visually hidden (`sr-only`); the label is the button.
- Options and order: `PURCHASE_PRIORITIES` (`normal`, `urgent`, `critical`)
  with Thai labels from `PURCHASE_REQUEST_PRIORITY_LABEL`
  (ปกติ / ด่วน / ด่วนมาก). The enum, validator, action, and DB are untouched.
- State: same `priority` useState; default stays `normal`; reset to `normal`
  after successful submit (existing behavior).
- Layout: one row, 3 equal-width segments (`flex`, each `flex-1`), `h-11`
  tap targets, replacing the select in the right column of the date/priority
  row (full width when stacked on mobile).
- Color — selected state only; unselected segments are neutral white/outline
  so the row doesn't read as an alert:
  - ปกติ selected: solid zinc (bg-zinc-700, white text)
  - ด่วน selected: solid amber (bg-amber-500, near-black text for contrast)
  - ด่วนมาก selected: solid red (bg-red-600, white text)
  - Focus: `focus-visible` ring as elsewhere in the form; disabled while
    submitting like the other inputs.

## Out of scope

List/queue rendering (already pilled), enum changes, other forms.

## Verification checklist

- [ ] Unit test: 3 radios rendered with Thai labels, `normal` checked by
      default, clicking ด่วนมาก checks it and unchecks the rest.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] Mobile (375px) preview: row fits inside the card, no overflow.
