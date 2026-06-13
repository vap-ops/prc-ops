# Spec 67 — Design-critique remediation (the 9 survivors)

**Status:** COMPLETE (2026-06-13) — 8 of 9 shipped; #8 (disclosure-summary
chevrons) deferred as a subjective minor (the native `<details>` triangle is
present; the gripe was consistency). **Type:** UX/a11y fixes + anti-drift
test pins. No DB.

## Why

A ruthless multi-agent design critique (this session) produced 9 verified,
systemic flaws — six of them the code contradicting the team's OWN written
doctrine. The root cause is **drift detection**: the doctrine is sound, but
nothing enforces it, the spec-65 byte-pins guard paint not behaviour, and the
one-operator look-loop checks the one config where none of it shows. This unit
fixes the 9 AND pins the invariants so the drift can't recur.

## Fixes

**Critical**

1. **Thai line-height.** No leading override anywhere on a Thai-only app →
   wrapped headings crowd stacked tone marks. `DETAIL_TITLE` (the wrapping
   subject) gains `leading-snug`. (ui-conventions §2 amended.)
2. **Group-header `truncate`** (`work-package-list.tsx:205,210`) violated
   spec-57's "list rows never `truncate`" hard floor → mid-word clip on Thai.
   → `line-clamp-2 break-words`.
3. **Four stray `window.confirm`** (`upload-queue-runner`, `purchase-request-
cancel`, `purchase-request-ship`, `attachment-remove-button`) vs §7 "No
   window.confirm". → a shared `ConfirmActionButton` (button + `ConfirmDialog`
   - transition) for the three identical destructive buttons; inline
     `ConfirmDialog` for the queue-discard.

**Major**

4. **36px segmented control** (`work-package-list.tsx:147`, `min-h-9`) below
   the 44px floor. Fixed by #7's primitive.
5. **10–11px stepper text + `zinc-500`** meaningful dates
   (`purchase-request-tracker.tsx`) → `text-xs` + `zinc-600` (the §3 floor).
6. **Token drift:** "done/progress" green ships as `green-600` AND
   `emerald-600/700`; the current-phase bar reuses the reserved `blue-700`
   link hue. → canon: positive = **emerald**, in-progress/current = **amber**,
   blue-700 stays links-only. `phase-progress-bar` + 4 stray `green-600`
   badges → emerald.
7. **Fake radiogroup** (`role="radio"` on plain `<button>`, no keyboard) in
   `work-package-list` AND `worker-roster-manager`. → extract the proven
   `RadioChip` (native `sr-only` radio, keyboard for free, `min-h-11`) from
   `generate-report-button` to a shared component; adopt at all three (dedups,
   fixes #4 + #7 together).

**Minor**

8. **Unsignified `<details>` summaries** (WP-detail) → add the app's
   chevron idiom (matches the WP-list group header).
9. **`/workers` reachability** — labor empty-state names the page in dead
   prose; make it a link for PM/super. **Dead `.dark` palette** in
   `globals.css` (never applied, contradicts "no .dark ever") → removed.

## Anti-drift test pins (the point of the unit)

`tests/unit/design-doctrine.test.ts` (new) asserts, by reading the source:
no `truncate` on the WP-list group header; the segmented control is
`min-h-11`; zero `window.confirm` in `src/`; `DETAIL_TITLE` carries a
`leading-` class; no `bg-green-`/`text-green-` in `src/` (emerald only);
`phase-progress-bar` current segment is not `blue-700`. Drift becomes a red
test, not a thing the operator has to spot.

## Verification

`pnpm lint && pnpm typecheck && pnpm test` + `pnpm build` green. Adversarial
review of the diff (each fix removes the flaw without regressing; pins are
real). Acceptance = operator eye on deploy (nothing should look broken; the
control is taller, the greens unified, the stepper legible).
