# Spec 72 — Notes everywhere (program) + Unit 1: shared NotesField + projects.notes

**Status:** COMPLETE (2026-06-13; migration APPLIED to prod, pgTAP 808/808; operator go/no-go = "Apply now").
**Plan:** `~/.claude/plans/hashed-swimming-duckling.md` (approved 2026-06-13).
**Builds on:** spec 71 (work_packages.notes), spec 58/ADR 0042 (`update_project_settings`).

## Program

Operator: "notes on every db, which means every process." An editable free-text backup field on
every user-facing entity. Architecture (decided): a per-entity `notes text` column + ONE shared
presentational `NotesField` component (generalize `WorkPackageNotes`), NOT a unified table. Write
path reuses each entity's doctrine; a column-only SECURITY DEFINER RPC only where the writer lacks
UPDATE. App cap 1000, DB `CHECK (notes is null or length <= 2000)`.

Operator scope: existing-screen entities first — **projects (this unit), purchase_requests
(editable), labor (per-day note), workers**. Deferred (need a new screen): suppliers, contractors.
Excluded: deliverables (no surface), reports (machine artifact). Units 2-4 = specs 73-75.

## Unit 1 scope

### Shared scaffolding (no DB)

- `src/lib/notes/validate.ts` — generic `validateNotes(raw, max = NOTES_MAX=1000)` (trim → empty=null
  → cap). `src/lib/work-packages/validate-notes.ts` re-exports it (`validateWorkPackageNotes` stays;
  its test + the WP action stay green).
- `src/components/features/notes-field.tsx` — `'use client'` presentational textarea + dirty/save/
  error/saved state, `useTransition`, `router.refresh()` on ok. Props: `notes` (seed), `onSave(value:
string) => Promise<NotesSaveResult>`, `fieldId`, optional `label`/`placeholder`/`maxLength`.
  Behavior lifted from `work-package-notes.tsx`; the `42501→Thai` mapping stays in each action.
- Refactor `work-package-notes.tsx` to render `<NotesField onSave=… fieldId="wp-notes" />`; its
  existing test is the regression guard.

### projects.notes (surface: `/sa/projects/[id]/settings`)

- **Migration** `20260624000300_project_notes.sql`: `projects.notes text` + CHECK ≤2000; DROP the
  3-arg `update_project_settings`, CREATE the 4-arg `(p_project_id, p_name, p_status, p_notes text
default null)` with **coalesce-preserve**: `notes = case when p_notes is null then notes else
nullif(btrim(p_notes), '') end` (a 3-arg call preserves notes; explicit `''` clears). Re-grant.
- **App:** `settings/actions.ts` `updateProjectSettings` gains `notes`, validates via `validateNotes`,
  passes `p_notes`. `settings-form.tsx` gains a notes textarea batched into the one submit
  (name+status+notes). Hand-extend `database.types.ts` (projects Row/Insert/Update + RPC 4th arg)
  then reconcile.
- **Tests:** `notes-field.test.tsx` (seed, disabled-until-dirty, onSave+refresh, error/no-refresh —
  RED first). settings-form unit (renders textarea, save passes notes). pgTAP `07-projects` (+notes
  col text/nullable, CHECK>2000) + `32-project-settings` (signature pins → 4-arg; PM sets note + note
  landed + blank clears to null).

## Verification

Local `pnpm lint && typecheck && test && build` green. Operator go/no-go before `db:push`; then
`db:push`, `db:types` reconcile, `db:test`. Tracker + Telegram.

## Acceptance

Open a project's settings (PM/super), type a note, save, reload → persists alongside name/status.
