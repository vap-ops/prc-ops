# Spec 75 — Notes everywhere Unit 4: worker roster note

**Status:** COMPLETE (2026-06-13; migration APPLIED to prod, pgTAP 831/831; operator go/no-go = "Apply now").
**Program:** spec 72 / plan. **Builds on:** spec 46 (workers master, RPC-only write). **Last existing-screen slice.**

## Why

An editable note on a roster worker (skills, contact, "probation", whatever the fields don't cover).
`workers` is RPC-only-write (rates are money), so the note rides the existing create/update RPCs.

## Scope

- **Migration** `20260624000600`: `workers.note` column + `CHECK <= 2000` + `grant select (note)`
  (presence data, not money — unlike `day_rate`). DROP+CREATE `create_worker` (+`p_note`,
  `nullif(btrim,'')`) and `update_worker` (+`p_note`, case-preserve: omitted keeps it, `''` clears).
  Bodies reproduced verbatim from `20260619000200` plus the note; the audit payloads are unchanged.
- **App:** `createWorker` + `updateWorker` actions gain `note` (validated via the shared
  `validateNotes`; create passes `p_note` only when non-empty; update passes the raw value incl. `""`
  to clear, omits to preserve). `WorkerRosterManager`: note textarea on the add form + the per-row
  edit block; shows a worker's note on the row. `note` threaded through `ManagedWorker` + the
  `/workers` page select + types.
- **Tests:** `worker-roster-manager.test.tsx` (new, RED first): row shows note, add passes note, edit
  passes note. pgTAP `29-labor-capture` (+6, placed after the audit-count pin): create stores a note,
  update sets a note, a note-only update preserves the name (coalesce), CHECK>2000.

## Acceptance

On `/workers` (PM/super): add a worker with a note → shows on the row; edit a worker's note → persists.

## Rollout complete

This finishes the notes-everywhere **existing-screen** rollout: work_packages (71), projects (72),
purchase_requests (73), labor (74), workers (75). Deferred: suppliers + contractors (need a management
screen first); deliverables, reports excluded; the app-feel design round (see memory) is next up.
