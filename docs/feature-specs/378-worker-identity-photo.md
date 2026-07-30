# 378 — Worker identity photo, captured by the site admin

**Status:** draft, 2026-07-30
**Origin:** operator, 2026-07-30 — _"allow each scan to add to team, then allow SA to confirm or
edit, displaying profile image of the technicians scanned."_ The confirm/edit half is
[spec 379](379-muster-undo-check-in.md). This spec is its missing prerequisite: **there is no
picture of a worker anywhere in the system.**
**Schema:** YES — one column, one grant, one storage policy, one new RPC, one new role helper.
Claims the schema lane. Code-only follow-ups build on top.

---

## 1. Why this exists

The operator wants faces on the muster confirm surface so the SA can tell at a glance that the
right person was scanned. Gate-checked live 2026-07-30, the data does not exist:

- `workers` has **no** photo / image / avatar column (all 27 columns enumerated).
- There is **no worker-photo storage bucket** (13 buckets, none applicable).
- The only image anywhere is `users.line_avatar_url`, which requires a login:
  **14 of 31 active workers are bound to a user, and 12 of those have an avatar — ~39 %.**

A LINE avatar is also the wrong artifact. It is self-chosen (a cartoon, a landscape, a group
photo), it changes whenever the worker changes it, and it is missing for the 17 unbound workers —
who are exactly the phoneless crew the muster flow exists to serve. **An identity check that
works for 39 % of the crew and shows a cartoon for some of them is worse than showing nothing**,
because it teaches the SA to stop looking.

### 1.1 The failure this spec must avoid, named up front

Spec 248 built `answers_photo_id` and it holds **0 of 2,712 photos** — because it required a
curatorial act nobody had a moment for. A worker photo has exactly the same shape. **If capturing
a face is a separate chore on a page the SA visits rarely, this column will read 0/31 forever.**

Therefore the design rule for this spec: **the capture must ride a flow the SA is already in**,
and acceptance is a fill-rate query, not a green suite (§7).

---

## 2. Decisions

**D1 — One current photo per worker, stored as a path on `workers`.** Not a gallery, not a
history. `workers` is not in the append-only family: it carries a single BEFORE UPDATE trigger,
`workers_firm_tie_money_wall`, which raises only on a `contractor_id` NULL→NOT NULL transition and
is inert for a `photo_path` write. So a replace is an UPDATE of the column plus a delete of the
superseded object. A face photo has no evidentiary value that a second copy would preserve —
unlike `photo_logs`, this is an identity aid.

**D2 — Reuse the `contact-docs` bucket with a new top-level folder `worker-photo/`.** This is the
established pattern, not an invention: `sa_add_project_worker_with_bank` already takes a
`p_photo_path`, validates `split_part(p_photo_path,'/',1) = 'sa-bank-capture'`, and its 14 objects
live in `contact-docs`. A new bucket would need its own policy set, its own signed-URL plumbing
and its own PDPA argument for no gain.

**D3 — The write does NOT go through `update_worker`.** ⚠️ This is the finding that would
otherwise have produced an affordance-then-refuse bug: `create_worker` and `update_worker` gate on
`is_back_office(current_user_role())`, whose live membership is
`project_manager · super_admin · procurement · procurement_manager · project_director` — **it
excludes `site_admin`.** The SA, who is the only person holding a phone in front of the worker,
cannot call either. Routing the photo through them would render a button the server refuses.

So: a new `set_worker_photo` RPC gated like the other SA-facing worker RPCs —
`('site_admin','super_admin','procurement_manager')` **plus `can_see_project`** — which is the
verbatim gate on `sa_add_project_worker_with_bank`, `sa_add_project_worker` and `muster_scan_in`.

**D4 — The storage policy DELEGATES to a role helper; it does not restate the role list.** The
existing `sa bank-capture uploads by site_admin` policy inlines
`current_user_role() = ANY (ARRAY['site_admin','super_admin','procurement_manager'])`. That is the
shape that caused #823 (a hardcoded array in a `storage.objects` policy drifted away from the
helper the app used, and the only person who curates the catalog was 403'd for two weeks behind a
generic "try again"). No existing helper matches this trio — `is_site_staff` is wider (it adds
`project_manager`/`project_director`), `is_back_office` excludes `site_admin`. So this spec adds
`public.is_sa_capture_role(user_role)` and points **both** policies at it — the new one and the
bank-capture one (sibling sweep; a hazard identified is a hazard swept).

**D5 — Capture rides two flows the SA is already in, and no third one is built.**

1. **Add-a-worker.** `sa_add_project_worker_with_bank` already stops the SA to photograph a
   passbook. The face is one more shot in the same sheet, at the moment the worker is physically
   standing there. (Whether it is _required_ like the passbook is §8's operator call.)
   ⚠️ **This is not free, and it is where the scope header could quietly have grown.** That RPC writes its
   `p_photo_path` into the separate `worker_bank_capture` table and never touches `workers`, so
   the face cannot ride the same parameter. Two options, and the spec picks the second: (a) add a
   parameter to that money-adjacent DEFINER function — widening a signature means DROP+CREATE, not
   `OR REPLACE`, or you get an overload (the spec-357 U-F lesson); or (b) **the sheet calls
   `set_worker_photo` as a second step after the worker row exists.** (b) keeps the bank RPC
   untouched and keeps this spec's surface to one new function, at the cost of a two-call sheet
   whose second call can fail on its own — so the sheet must state that outcome in place rather
   than dismissing on partial success (the silent-success rule).
2. **Muster.** The `ยังไม่มา` and member rows on the cockpit are where the SA meets every worker
   every morning. A worker with no photo gets a small camera affordance on their row.

Not built: a bulk "photograph the roster" screen. That is the spec-248 chore shape.

**D6 — Replace, never accumulate.** Setting a new photo deletes the previous storage object. A
worker's face is the most re-shootable thing in the app (bad light, hard hat, eyes closed) and
orphaned objects in a PDPA-relevant bucket are a liability, not an archive.

**D7 — Deactivating a worker does not delete the photo; §8 owes the retention rule.** Out of
scope to implement, in scope to name: this is personal data with no stated retention period, and
the app has no worker-offboarding data path today (see the parked `deactivated_at` work).

---

## 3. Model

### 3.1 Schema (one migration, claims the lane)

```sql
alter table public.workers add column photo_path text;

-- The workers PII wall exposes a deliberate subset of 14 columns to `authenticated`
-- (id, name, project_id, level, pay_type, employment_type, active,
-- cost_confirmed_at, note, contractor_id, user_id, gender, created_at, created_by).
-- The 13 walled ones are day_rate, phone, tax_id, bank_name,
-- bank_account_number, bank_account_name, email, emergency_contact_name,
-- emergency_contact_relation, emergency_contact_phone, date_of_birth,
-- employee_id and cost_confirmed_by.
-- photo_path joins the exposed set (making it 15) — the muster board and roster
-- must render it for every signed-in caller who can already see the worker's row.
grant select (photo_path) on public.workers to authenticated;
```

⚠️ This is a **one-column widen of the PII wall**, the same move spec 357 U-F made for `gender`
(and only that). It does not touch the row-level wall. The pgTAP column-privilege pin must be
updated deliberately, never weakened.

### 3.2 The role helper + storage policies

```sql
create or replace function public.is_sa_capture_role(p_role public.user_role)
returns boolean language sql immutable as $$
  select coalesce(p_role in ('site_admin', 'super_admin', 'procurement_manager'), false)
$$;
```

Coalesce-hardened, matching the house style (`is_back_office`, `is_site_staff`) — an unbound
caller must read `false`, not NULL (the RLS self-check coalesce trap).

New INSERT policy on `storage.objects` for `bucket_id='contact-docs'` and
`(storage.foldername(name))[1] = 'worker-photo'`, delegating to `is_sa_capture_role`. The existing
`sa bank-capture uploads by site_admin` policy is rewritten to delegate to the same helper —
behaviour-identical today, drift-proof tomorrow.

⚠️ Folder depth: the bank-capture policy does not constrain depth, but the
`subcontract-crew-docs` one does (`array_length(storage.foldername(name),1) = 2`). Pick the depth
deliberately — `worker-photo/<worker_id>/<uuid>.jpg` is depth 3. **Whatever depth the path builder
produces, the policy must admit exactly that**; #823's sibling defect was a policy admitting only
depth 1 while the code wrote depth 2, refusing every upload.

### 3.3 The RPC

`set_worker_photo(p_worker uuid, p_photo_path text) returns void`, SECURITY DEFINER,
`set search_path to 'public'`, revoked from `public, anon` (⚠️ a NEW function gets a default
PUBLIC EXECUTE — the revoke must name `public` as well as `anon`, the #833 lesson).

Guards, in order:

1. role ∈ `is_sa_capture_role(current_user_role())`, else `42501`.
2. worker exists, else `P0001`.
3. `can_see_project(worker.project_id)`, else `42501`. ⚠️ `workers.project_id` is nullable — a
   worker with a null project (the old staff-approval rows) must be handled explicitly, not
   silently admitted by a NULL-swallowing predicate.
4. `split_part(p_photo_path,'/',1) = 'worker-photo'`, else `P0001` — mirrors the passbook check.
5. Writes `photo_path`, returns the superseded path so the caller can delete the object.
6. Audit: `worker_change` with `payload->>'event' = 'worker_photo_set'` (the house convention is
   an existing action plus an event key in the payload, not a new enum value).

---

## 4. Surfaces

- **`/team/roster` worker row** — the photo renders where names are listed; tapping it opens the
  capture sheet. This is also the repair path for a bad shot.
- **Add-a-worker sheet** — one more shot beside the passbook.
- **Muster cockpit** — a worker with no photo carries a small camera affordance on their member /
  `ยังไม่มา` row. This is the backfill engine for the existing 31.
- **Signed URLs** — the bucket is private (all 13 are). ⚠️ The muster board mints **nothing**
  today: there is no storage or photo reference anywhere under
  `src/app/projects/[projectId]/muster/` or `src/components/features/muster/`, so faces are new
  I/O on that page, not an extra row on an existing call. The helper to reuse is
  `mintSignedUrls` in `src/lib/storage/signed-urls.ts` — it runs **service-role**, which is why
  this spec needs only an INSERT policy and no storage SELECT policy. Its `SignableRow` shape is
  `{id, storage_path}`, so a `photo_path` row needs mapping. Rendering N faces is an N-URL mint
  per load — measure before putting faces on a list of 30+.

⚠️ **The muster tally rows do not carry the `ช/ญ` chip today** (`genderChip` renders on the tap
list and member/`ยังไม่มา` rows only). If faces are going on the tally, the gender chip should go
with them — same row, same purpose.

---

## 5. PDPA — an operator decision, not a developer default

A photograph of an identifiable person's face is personal data under PDPA, collected by the
employer, stored indefinitely, visible to every signed-in user who can see that worker's row.
The app already has a consent surface for workers (`revokeOwnConsent`, the onboarding agreement
salvaged from the dropped spec 267) but **nothing in this spec is covered by it today**.

Named here, deliberately unresolved (§8): whether a notice/consent step is required at capture,
what the retention period is, and whether a worker may request deletion. **Do not build the
capture until §8.1 is answered** — collecting first and asking later is the wrong order for
personal data.

---

## 6. Non-goals

- No face _recognition_, matching or auto-identification. The photo is an aid to a human check.
- No photo history or supersede chain (D1).
- No worker-facing self-upload — the SA captures. (A self-serve path is the [[self-governance-doctrine]]
  direction and can come later; it cannot come first, because 17 of 31 workers have no login.)
- No change to the LINE avatar. `users.line_avatar_url` stays what it is and is not a fallback:
  mixing a self-chosen picture with a captured identity photo in one slot makes neither
  trustworthy.

---

## 7. Acceptance — a fill-rate query, not a green suite

```sql
select count(*) filter (where active) as active_workers,
       count(*) filter (where active and photo_path is not null) as with_photo,
       round(100.0 * count(*) filter (where active and photo_path is not null)
             / nullif(count(*) filter (where active), 0), 1) as pct
from public.workers;
```

Baseline is **0 of 31**. If this has not moved off 0 a week after the capture surfaces ship, the
capture did not ride a flow the SA is actually in, and the spec-248 failure has repeated —
re-open §D5 rather than adding a reminder.

⚠️ **There is no second measure yet, and the obvious one is a trap.** "Faces should reduce
`muster_undo` events" reads well but is unmeasurable from today's baseline: spec 379's undo does
not exist, so its count is 0, and 379 §6 reads a _rising_ undo count as its own success. From 0
those two readings point in opposite directions on the same number. **Only after 379 has shipped
AND passed its own adoption test does an undo rate become a baseline this spec can be measured
against.** Until then, fill rate is the only honest measure here.

---

## 8. Owed before build

1. 🔔 **PDPA (§5)** — consent/notice at capture, retention, deletion-on-request. Blocking.
2. 🔔 **Is the face photo REQUIRED at add-a-worker, like the passbook is?** Required maximises
   fill rate and is consistent with the existing sheet; optional risks the 248 outcome. Operator's
   call because it makes onboarding slower in the field.
3. Folder depth for `worker-photo/…` (§3.2) — fix the path builder and the policy together.
4. Whether the muster board renders faces for a whole team at once, given the signed-URL cost
   (§4). Measure before committing.
