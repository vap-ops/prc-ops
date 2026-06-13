# Spec 74 — Notes everywhere Unit 3: labor-day note

**Status:** COMPLETE (2026-06-13; migration APPLIED to prod, pgTAP 825/825; operator go/no-go = "Apply now").
**Program:** spec 72 / plan. **Builds on:** spec 46 (labor capture, append-only supersede).

## Why

An optional free-text note on a daily labor entry ("worked overtime", what the crew did). `labor_logs`
is append-only (supersede), so the note is a per-row **snapshot** set at `log_labor_day` and **carried
forward** through corrections (like the rate/name snapshots); a tombstone removal carries `note = null`.

## Scope

- **Migration** `20260624000500`: `labor_logs.note` column + `CHECK <= 2000` + `grant select (note)`
  to authenticated (presence data, not money — unlike `day_rate_snapshot`). DROP+CREATE
  `log_labor_day` (+`p_note`, `nullif(btrim,'')`) and `correct_labor_log` (+`p_note` with
  carry-forward: `case when p_tombstone then null when p_note is null then v_orig.note else
nullif(btrim,'') end`). Bodies reproduced verbatim from `20260619000300` plus the note.
- **App:** `logLaborDays` action gains `note` (validated via the shared `validateNotes`, passed as
  `p_note` to every entry in the batch). `correctLaborLog` is unchanged — the RPC carries the note
  forward automatically (editing a labor note post-entry is a recorded seam). `LaborLogZone` gets a
  note textarea on the entry form (one note for the day's crew) and shows each row's note. `note`
  threaded through `LaborDisplayRow` + `fetch-zone-data` (the column-scoped select) + types.
- **Tests:** `labor-log-zone.test.tsx` (+entry passes note, +row renders note); `labor-current-logs`
  fixture gains `note`. pgTAP `29-labor-capture` (+7): note stored at entry, carried through a
  correction, cleared on tombstone, CHECK>2000. LESSON: the "current" row is the **anti-join**
  (`not exists newer.superseded_by = ll.id`), never `superseded_by is null` (that's the original a
  correction supersedes) — my first pgTAP draft tombstoned an already-superseded row.

## Acceptance

Log a day for a crew with a note → it shows on each row. Correct an entry → the note persists. Remove
an entry → the note goes with it.

## Seam (recorded)

Editing a labor note after entry (the `correct_labor_log` `p_note` param exists but the UI doesn't
expose it yet — a correction carries the note forward unchanged).
