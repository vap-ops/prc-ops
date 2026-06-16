# Spec 122 — Feature components grouped into domain folders

**Status:** PROPOSED (2026-06-16)
**Type:** refactor — zero behavior change, zero visual change, zero DB change.
Pure file move + import-path rewrite.
**Origin:** codebase-understanding review (2026-06-16). `src/components/features/`
holds 62 `.tsx` files in one flat directory; ownership and navigation degrade as
the count grows. `src/lib/` is already domain-foldered — this brings components
to parity. No ADR: a folder taxonomy is reversible and low-stakes; the taxonomy
below IS the raised architectural choice.

## Doctrine

1. **Behavior-preserving** — every moved file's contents are byte-identical; the
   only edits anywhere are import specifiers that point at a moved file.
2. **Validated by existing suites** — `pnpm lint && pnpm typecheck && pnpm test`
   plus a production build. `tsc` is the proof that no import was missed.
3. **No new features, no DB migrations, no UI/markup change, no component renames,
   no new barrel/`index.ts` files** (barrels hurt RSC boundaries + tree-shaking).

## Test first

`tests/unit/feature-components-structure.test.ts` (written first; red before the
move):

- Reads `src/components/features/` with `node:fs`.
- Asserts **no `*.tsx` file lives directly in the root** — every component sits
  in a domain subfolder.
- Asserts **every subdirectory name is in the allowed domain set** (the 7 below).
- (`.gitkeep` removed once real subfolders exist.)

This fails today (all 62 files are in the root) and passes once the move lands.

## Domain taxonomy + full mapping

Seven folders under `src/components/features/`:

### `purchasing/` (21)

invoice-uploader · site-purchase-acknowledge · purchase-request-notes ·
purchase-record-form · purchase-request-attachment-stager · purchase-request-cancel ·
purchase-request-card · purchase-request-decision · purchase-request-form ·
purchase-request-ship · purchase-request-tracker · purchase-mini-stepper ·
site-purchase-form · record-manager · procurement-filters · procurement-grid ·
phone-po-basket · create-po-from-request-button · create-purchase-order-sheet ·
delivery-photo-uploader · attachment-remove-button

### `work-packages/` (8)

work-package-notes · work-package-info-button · wp-assignment-panel ·
wp-priority-control · wp-schedule-panel · schedule-gantt · phase-progress-bar ·
project-info-button

### `photos/` (3)

photo-lightbox · photo-strip · upload-queue-runner

### `labor/` (4)

labor-cost-view · labor-log-zone · worker-roster-manager · refreeze-button

### `contacts/` (4)

contact-bank-block · contact-crew-section · contact-documents-block · contacts-tabs

### `chrome/` (10)

app-header · detail-header · page-shell · page-skeleton · bottom-tab-bar ·
hub-nav · worklist-row · viewport-scroll-guard · sw-register · coming-soon-badge

### `common/` (12)

attention-card · count-chip · status-pill · radio-chip · avatar-surface ·
confirm-action-button · confirm-dialog · bottom-sheet · notes-field · notices ·
toast-provider · refresh-button · display-name-form

> 62 files = 21+8+3+4+4+10+12. `display-name-form` is profile-specific but the
> only profile component, so it folds into `common/` rather than create a
> singleton folder. If a future profile cluster appears, promote it then.

## Implementation

1. Write the structural test (red).
2. Move each file into its domain folder (`git mv` to preserve history; the diff
   shows as a rename, not delete+add).
3. Rewrite every importer: `@/components/features/X` →
   `@/components/features/<domain>/X`. Importers include app routes, other feature
   components (cross-domain imports stay valid, just re-pathed), and `tests/`.
   `tsc` flags any missed specifier.
4. Delete `src/components/features/.gitkeep`.
5. `components.json` alias is unchanged (`@/components`); shadcn primitives in
   `src/components/ui/` are untouched.

## Out of scope (recorded for the queue)

- Subdividing `src/components/ui/` (only 3 files — not worth it yet).
- Any barrel/`index.ts` re-export files.
- Renaming components or changing their public props.

## Verification checklist

1. `pnpm lint` clean.
2. `pnpm typecheck` clean (this is the no-missed-import proof).
3. `pnpm test` — all green, including the new structural test.
4. `pnpm build` green (placeholder env on cloud PC).
5. `git diff` audit: only renames + import-specifier edits; no file body changed.
