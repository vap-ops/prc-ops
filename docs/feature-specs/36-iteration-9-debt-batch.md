# Spec 36 — Iteration-9 debt batch

**Status:** locked & shipped — 2026-06-12. Six carried queue items, no
new features, no schema change.

## Scope (in)

1. **browser.ts `<Database>` generic** — the last untyped Supabase
   client (server.ts fixed 2026-06-11, admin.ts in spec 33). Surfaced
   zero new type errors.
2. **Server-side length caps** (security minor, carried since
   iteration 8): `validateCreatePurchaseRequest` rejects
   `item_description` > 500 and `unit` > 40 chars — the client
   `maxLength` attributes were the only bound; a forged action payload
   could bloat the site-wide /requests SSR. Test-first. **DB CHECK
   constraints remain a recorded follow-up** (needs a prod data-length
   sanity check before adding constraints to a live table).
3. **Pending-band comparator extracted + pinned**
   (`src/lib/purchasing/pending-order.ts`, 3 unit tests) — the spec-19
   §4 / spec-16 A2 ordering (priority band, then oldest-first) had no
   test.
4. **Tap-target geometry (gloved hands):** phase-uploader retry button
   → real `min-h-11`; photo remove button → 44 px transparent hit
   square wrapping the 28 px visual disc, positioned fully inside the
   tile so the wrapper's `overflow-hidden` cannot clip the hit area
   (the first attempt used `after:-inset-2`, which the tile clipped —
   review catch).
5. **Spinner contrast:** `className` override; the red remove button
   passes a white-track variant (default dark track was ~1.8:1 on red).
6. **ZoomablePhoto focus ring:** `focus-visible:ring-inset` — thumbnail
   wrappers use `overflow-hidden`, which clipped the keyboard focus
   ring entirely.

## Resolved-as-stale

- "Reports breadcrumb/header text-xs links" (iteration-9 queue): all
  three links already carry `min-h-11` since the nav-coherence unit —
  no change needed.

## Out / still queued

- DB CHECK length constraints (above), dark/night-shift toggle
  (operator decision), real logo (needs asset), dialog a11y
  foundation, decided-history pagination.

## Verification

- RED→GREEN: caps + comparator tests written first. 354 unit / 27 e2e
  green; typecheck + lint clean; no `supabase/` diff. Reviewer pass
  (1-agent diff review) — hit-area clipping finding fixed pre-commit.
