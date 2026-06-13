# Spec 73 — Notes everywhere Unit 2: editable purchase-request note

**Status:** COMPLETE (2026-06-13; migration APPLIED to prod, pgTAP 818/818; operator go/no-go = "Apply now").
**Program:** spec 72 / plan `~/.claude/plans/hashed-swimming-duckling.md`. **Builds on:** spec 48 (requester note), ADR 0038 (column-scope doctrine).

## Why

Spec 48 made `purchase_requests.notes` write-once by GRANT posture (authenticated INSERT only, no
UPDATE). The operator wants the note editable so a user can keep adding info. We **keep the no-UPDATE
grant** (the column-scope posture is unchanged — file 30 still pins it) and add a SECURITY DEFINER RPC
as the controlled edit path.

## Scope

- **Migration** `20260624000400`: `set_purchase_request_notes(p_id, p_notes)` SECURITY DEFINER RPC —
  the request's **requester** edits their own note (`requested_by = auth.uid()`), **back-office**
  (project_manager / procurement / super_admin) edits any; else 42501. `nullif(btrim,'')` clears;
  `return found`; revoke/grant execute. Plus `CHECK (notes is null or length <= 2000)` on the column
  (app cap 1000; abuse backstop). The definer (table owner) bypasses the column grant + RLS.
- **App:** `requests/[requestId]/notes-actions.ts` `setPurchaseRequestNotes` (UUID + 1000 validate,
  relay, map 42501 → Thai, revalidate). `purchase-request-notes.tsx` wrapper over the shared
  `NotesField`. On `/requests/[id]` the read-only note block is replaced: editable for
  `isMine || isBackOffice`, read-only text otherwise. Hand-extend `database.types.ts` (RPC) + reconcile.
- **Tests:** `purchase-request-notes.test.tsx` (3, RED first). pgTAP `30-purchase-request-notes`
  expanded (kept the 3 grant-posture pins; +10: catalog + requester edits own + back-office edits any
  - non-requester SA 42501 + visitor 42501 + blank clears + CHECK>2000).

## Acceptance

Open a request you raised → edit + save the note. As PM/procurement, edit a note on a request you
didn't raise. As a site_admin who isn't the requester, the note shows read-only.

## Open posture (recorded)

The note stays editable after a decision (allow-always, role-gated only) — a benign backup field.
