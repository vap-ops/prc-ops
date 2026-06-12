# Spec 65 — Consolidation pass (behavior-preserving refactor)

**Status:** COMPLETE (2026-06-13)
**Type:** refactor — zero behavior change, zero visual change, zero DB change
**Origin:** operator session brief "full refactoring session". Candidates were
produced by a 5-surveyor multi-agent sweep over `src/` and adversarially
verified one-by-one (76 surveyed → 66 confirmed → this spec selects the
mechanical, byte-identical subset). Rejected/deferred items are recorded in
§Out-of-scope and the tracker queue.

## Doctrine

Every change in this spec must satisfy all three:

1. **Behavior-preserving** — rendered markup/class strings byte-identical,
   server action contracts unchanged, queries unchanged (except where a
   shared constant reproduces the same string).
2. **Validated by existing suites** — `pnpm lint && pnpm typecheck && pnpm test`
   plus a production build. New shared modules get their own unit tests
   (written first, TDD).
3. **No new features, no DB migrations, no UI redesign.**

## A. New shared primitives (with new unit tests)

| New module                                     | Exports                                                                                                                                                                         | Replaces                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/validate/uuid.ts`                     | `UUID_REGEX`, `isValidUuid`                                                                                                                                                     | 10 private regex copies + 2 duplicated type-guards. `src/lib/photos/path.ts` re-exports `isValidUuid` so existing importers stay valid.                                       |
| `src/lib/dates.ts`                             | `bangkokTodayIso`, `ISO_DATE_REGEX`                                                                                                                                             | 3 `bangkokToday` copies + 3 private ISO regexes. `src/lib/labor/dates.ts` becomes a re-export for compat.                                                                     |
| `src/lib/storage/buckets.ts`                   | `PHOTOS_BUCKET`, `PR_ATTACHMENTS_BUCKET`, `REPORTS_BUCKET`                                                                                                                      | scattered bucket string literals (Storage calls only — DB `.from("reports")` reads are unrelated and untouched).                                                              |
| `src/lib/storage/signed-urls.ts` (server-only) | `mintSignedUrls(bucket, rows)` generic core                                                                                                                                     | the self-described clone pair `photos/signed-urls.ts` / `purchasing/attachment-signed-urls.ts`; both keep their exported names as thin typed wrappers — call sites untouched. |
| `src/lib/db/enums.ts`                          | canonical enum aliases (`UserRole`, `WorkPackageStatus`, `ProjectStatus`, `PhotoPhase`, `ApprovalDecision`, `ReportStatus`, `PurchaseRequestStatus`, `PurchaseRequestPriority`) | per-module re-derivations. Existing modules convert to re-exports so no import site breaks.                                                                                   |
| `src/lib/auth/action-gate.ts` (server-only)    | `getActionUser()`, `NOT_SIGNED_IN`                                                                                                                                              | the 22 copy-pasted `getUser` + Thai not-signed-in blocks in server actions. Each action keeps its own return shape; messages stay byte-identical.                             |
| `src/lib/photos/phases.ts`                     | `PHASES` display list, `latestCreatedAt(photos)`                                                                                                                                | verbatim duplicates in the SA and PM WP detail pages.                                                                                                                         |
| `src/lib/auth/role-home.ts` (extended)         | `PM_ROLES`, `SITE_STAFF_ROLES`                                                                                                                                                  | 3 local consts + ~11 inline role arrays.                                                                                                                                      |
| `src/lib/photos/path.ts` (extended)            | `PHOTO_ACCEPT_MIME` (derived `PHOTO_EXTS.map(photoExtToMime).join(",")`)                                                                                                        | 3 hand-written `accept` attribute lists.                                                                                                                                      |

## B. `classes.ts` additions + adoption (byte-identical values only)

New constants in `src/lib/ui/classes.ts`, values copied byte-for-byte from
the sites that hand-roll them today. Adoption ONLY at sites whose current
string is byte-identical (or where the constant is a verbatim leading
substring composed as `` `${CONST} extra` ``). Near-variants stay untouched.

- `CARD` (already exists, zero consumers) → adopt at the 9 verbatim sites.
- `SECTION_HEADING` = `mb-3 text-base font-semibold text-zinc-900` → ~10 sites.
- `DETAIL_TITLE` = `text-2xl font-bold tracking-tight break-words` → 5 sites (only if byte-identical at each).
- `FIELD_INPUT` = the `h-11 … px-3 … placeholder:text-zinc-400 …` input string → ~5 sites.
- `FIELD_SELECT` = the `h-11 … px-2 …` select string → 2 sites.
- `FIELD_STACKED` = the `mt-1 w-full … py-2 …` labor-form field string → worker-roster-manager `FIELD_CLASSES` + labor-log-zone inline copy.
- `BUTTON_PRIMARY_COMPACT` / `BUTTON_SECONDARY_COMPACT` = worker-roster-manager's local pair → both labor components (labor-log-zone line-167 near-variant stays).
- `BUTTON_SECONDARY_MUTED` = delivery-photo-uploader's muted secondary → the 3 uploader sites if byte-identical.
- `INLINE_ALERT_TEXT` = `text-xs font-medium text-red-700` → 6 borderless alert sites.
- `BANNER_ERROR` = `rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900` → login page + standalone login button.
- purchase-request-form's hand-rolled INLINE_ERROR variant → `` `${INLINE_ERROR} font-medium` ``.

A unit test pins every new constant's exact value so drift is a test failure.
`docs/ui-conventions.md` §5 constant list is updated in the same unit.

## C. Mechanical consolidations inside existing files

- `src/app/requests/actions.ts`: extract file-local `findLandedAttachment()`
  (the ADR-0039 identity-complete replay check, 3 verbatim copies) and
  `readPrParent()` (2 copies); hoist repeated Thai error literals into
  file-local constants per the precedent in other action modules. Strings
  byte-identical.
- SA + PM WP detail pages: import `PHASES` / `latestCreatedAt` from
  `src/lib/photos/phases.ts`; delete the local copies.
- Stale comment fix: SA WP page comment claiming `/requests?wp=` pinned mode
  is orphaned — corrected to name the PM screen as the remaining producer
  (comment-only).
- Redundant `as UserRole` / `as ReportStatus` identity casts deleted at the
  ~11 sites where the expression already has the target type (tsc proves
  each removal; any failure = genuine mismatch, surface it, don't cast).
- `LaborLogZone`: delete the never-used `projectId` prop (component + 2 call
  sites). Move `LaborDisplayRow` type into `src/lib/labor/types.ts`;
  `labor-log-zone.tsx` re-exports the type for compat.
- `PR_LIST_COLUMNS` const in `src/lib/purchasing/columns.ts`; `/requests`
  list uses it verbatim, detail page composes `` `${PR_LIST_COLUMNS}, notes` ``.
  SA WP page's narrower select stays its own named const.

## D. Dead code removal

- `fetchAssignableStaff` + `StaffOption` in `src/lib/users/display-names.ts`
  (admin-client query with zero callers — also attack-surface reduction).
- `export` keyword dropped from `formatPrNumber` (compose-notification) and
  `DOWNSCALE_QUALITY` (downscale) — internals, no external consumers.
- `src/components/ui/card.tsx` (zero consumers), `src/components/ui/button.tsx`
  - `tests/unit/button.test.tsx` (used only by its own test).
- Dead config: `**/*.mts` tsconfig include, `out/**`/`build/**` eslint
  ignores, `tests/unit/.gitkeep` (69 test files live there now;
  `tests/integration/.gitkeep` stays — load-bearing).

## E. Test-infra dedup (no assertion changes)

- `server-only` neutralized once globally: `src/test/server-only-stub.ts`
  (empty `export {}`) wired as a `resolve.alias` in `vitest.config.ts`;
  the 14 per-file `vi.mock("server-only")` preambles deleted (4 of them were
  already dead).
- Shared `tests/helpers/router-refresh.ts` mock factory; the 5 component
  tests that hand-roll the `next/navigation` refresh mock adopt it.
  Assertions unchanged.

## Out of scope (recorded for the queue — each needs its own spec)

- Upload-pipeline extraction across the 3 uploaders + `uploadPhotoIdempotent`
  (medium risk; needs the new component tests FIRST).
- `ConfirmActionButton` merge of the cancel/ship/attachment-remove trio.
- `ProjectListSection` shared between `/sa` and `/pm/projects` (the hub-merge
  design question owns this).
- PageSkeleton → PageShell/PAGE_MAX_W (changes transient loading-state width —
  needs operator sign-off as a visual change).
- `parseRequestsSearchParams` extraction + tests; `requireSessionProfile`
  for the coming-soon/profile pair; serverEnv test-mock dedup; e2e
  proxy-protection parametrization; Pick<Row> prop types; test-gap additions
  (run-report-job, labor error mapping, stager/runner component tests).

## Verification checklist

1. `pnpm lint` clean.
2. `pnpm typecheck` clean.
3. `pnpm test` — all green, including the new module tests.
4. `pnpm build` green (placeholder env on cloud PC).
5. `git diff` audit: no Thai string changed, no class string changed except
   identical-value substitutions, no migration files touched.
