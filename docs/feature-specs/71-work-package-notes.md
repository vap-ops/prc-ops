# Spec 71 — Notes as backup capture: work-package notes (v1 slice)

**Status:** COMPLETE (2026-06-13; migration APPLIED to prod, pgTAP 801/801; operator go/no-go = "Apply now").
**Depends on:** ADR 0013 (role-level access), ADR 0011 (RPC checklist), spec 31 (`set_work_package_contractor` RPC template), spec 48 (requester notes precedent).
**Operator decision (2026-06-13):** "add notes in places that might need it" → "Everywhere, we need them
as backups in case we forgot a field, user can still put information in notes instead." Plus: statuses
stay **text-only**, no icon work (color already carries the scan; 13 statuses have no intuitive glyph).

## 1. Why

The operator wants a **backup-capture** note: a free-text field on a record so a user can still write
down information the structured fields don't have a home for. Not a discussion thread — the same kind
of single notes field the app already has (`purchase_requests.notes`, `work_packages.description`).

Coverage today — **has** a note: `purchase_requests.notes` (write-once requester), `.decision_comment`,
`.delivery_note`, `photo_logs.comment`, `approvals.comment`, `work_packages.description` (read-only,
import-set), `labor_logs.correction_reason` (corrections only). **Gaps:** an editable WP remark,
supplier/contractor notes, a labor-day note.

"Everywhere" is the end state across slices. This spec ships the **highest-value, cleanest slice
first**: an editable note on the **work package** — the center of information (WP-centric principle).
Suppliers and contractors have **no edit UI** today (created/selected only), and `labor_logs` is
append-only — those slices need their own surfaces/handling and are staged below.

## 2. Scope

### In — work-package notes

1. **Column.** `work_packages.notes text` (nullable). App cap 1000 chars; DB `CHECK (notes is null or
length(notes) <= 2000)` as an abuse backstop (starts closing the queued DB-CHECK gap for this new
   column; the app layer is the UX cap).
2. **Write path.** `set_work_package_notes(p_work_package_id uuid, p_notes text)` SECURITY DEFINER RPC,
   **mirroring `set_work_package_contractor`** (spec 31): role gate `('site_admin','project_manager',
'super_admin')` else 42501; `search_path` pinned; revoke-then-grant execute to authenticated;
   normalizes `nullif(btrim(p_notes), '')`; `return found`. **Why an RPC:** SA is the on-site note
   author but `work_packages` UPDATE RLS is pm/super only — the RPC writes the `notes` column ONLY,
   without handing SA every WP column. No audit row (consistent with `set_work_package_contractor` —
   WP-column edits aren't individually audited; a note is benign ops text).
3. **Server action.** `setWorkPackageNotes(workPackageId, notes)` — UUID + length validation, action
   gate, relays the RPC, `revalidatePath` the WP page.
4. **UI.** A `WorkPackageNotes` client component (textarea + save, dirty/saved/error states) in the
   ข้อมูลงาน (work-info) zone of the **main WP detail page** `/sa/projects/[id]/work-packages/[id]`
   (admits sa/pm/super — the on-site + PM surface). Shows the current note; SA/PM edit and save.

### Out — staged seams (the rest of "everywhere")

- **Supplier notes / contractor notes** — need an edit surface first (none exists today); each its own
  slice (column + extend the existing UPDATE grant + a new edit form).
- **Labor-day note** — `labor_logs.note` set via a `log_labor_day` param; append-only carries it
  through corrections. Its own slice (RPC change + append-only handling).
- **Editable purchase-request note** — `purchase_requests.notes` is write-once (spec 48); making it
  editable post-creation is a deliberate posture change, recorded but not done here.
- **PM review page** (`/pm/work-packages/[id]`) read-only display of the WP note — small follow.

## 3. Files

- `supabase/migrations/20260624000200_work_package_notes.sql` — column + CHECK + RPC.
- `src/lib/work-packages/validate-notes.ts` — pure `validateWorkPackageNotes` (cap, trim).
- `src/app/sa/projects/[projectId]/work-packages/[workPackageId]/notes-actions.ts` — `setWorkPackageNotes`.
- `src/components/features/work-package-notes.tsx` — the textarea/save client component.
- `src/app/sa/projects/[projectId]/work-packages/[workPackageId]/page.tsx` — fetch `notes`, render the
  component in the work-info zone.
- `src/lib/db/database.types.ts` — hand-extend (notes column + RPC) then reconcile with `db:types`.

## 4. Tests (TDD — failing first)

Unit:

- `validate-notes.test.ts` — accepts ≤1000, rejects >1000, trims, empty → null.
- `work-package-notes.test.tsx` — renders current note; save calls the action with trimmed value;
  error surfaces on failure (mock the action).

pgTAP (after the gated `db:push`) — extend `08-work-packages.test.sql`:

- `notes` column exists, is text, nullable; the length CHECK rejects >2000.
- `set_work_package_notes`: SA writes a note (RPC returns true, row updated); pm/super write; visitor
  - procurement are refused (42501); a non-existent WP returns false; empty/blank → null.

## 5. Verification

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green (local).
- **Operator go/no-go before `db:push`.** Then `db:push`, `db:types` reconcile, `db:test`.
- Update `docs/progress-tracker.md`; `docs/ui-conventions.md` if the textarea pattern is new chrome.

## 6. Acceptance (operator)

Open a work package, type a note in the ข้อมูลงาน zone, save, reload — the note persists. Confirm SA
can write it (not just PM). The note is the catch-all for anything the structured fields miss.

## 7. Open questions / seams

The full "everywhere" rollout (suppliers, contractors, labor-day, editable PR notes, PM-review display)
— each its own slice per §2. DB-CHECK caps on the older text columns remain the standing queued item.
