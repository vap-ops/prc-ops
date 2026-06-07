# Feature Spec 09: Purchasing — data layer (P1a)

## Status

Locked — 2026-06-08. Backed by ADR 0022.
Read ADR 0022 in full before implementing — it carries the single-table
STATEFUL rationale, the dual-identity decision, the v1 requester narrowing,
and the relationship to ADR 0018 (AppSheet writer role, P2 work).

## Goal

Land the data layer for the Purchasing domain — a single stateful table that
carries a requisition from request through approval and (in P2) through the
purchase and delivery stages written by the AppSheet back-office writer.
This unit (P1a) ships the schema, RLS, server actions, and tests; no UI.

## Locked decisions

1. **Single STATEFUL table.** `purchase_requests` carries the full lifecycle
   on one row, walking
   `requested → approved | rejected → purchased → delivered`. Not append-only,
   not supersede — purchasing is a single back-office workflow rather than a
   multi-party decision event. ADR 0022 records the trade-off.
2. **Dual-identity requester.** `requested_by` (FK to `public.users`) +
   `requested_by_email` (text) + `source` (text). Native rows (`source='app'`)
   carry the FK; AppSheet rows (`source='appsheet'`, P2) carry the email.
   `pr_native_has_requester` and `pr_source_valid` CHECKs enforce the contract.
3. **v1 requester base = wp-readers (SA / PM / super_admin).** Narrowed from
   "any non-visitor" by owner decision 2026-06-07 — the diagnostic on
   `public.work_packages` SELECT showed only SA/PM/super can read WPs, so the
   requester pool starts there. Broadening is a future unit.
4. **RLS visibility split.** SELECT admits `requested_by = auth.uid()` OR
   `public.current_user_role() in ('project_manager','procurement','super_admin')`
   — a site_admin sees rows they requested but NOT another SA's; PM and
   procurement are the back-office reviewers and see all.
5. **Two-layer transition guard in the server action.** JS predicate
   (`isPurchaseDecision`, `isDecisionCommentValid`) plus SQL
   `.eq('status','requested')` clause on the UPDATE. 0 rows returned ⇒
   "not in requested state" (mirrors `recordDecision`).
6. **`database.types.ts` manually patched pre-merge.** `pnpm db:types` will
   supersede the patch after the delegated post-merge `db push`.

## Database

### Migration `20260608120000_create_purchase_requests.sql`

Enum:

```sql
create type public.purchase_request_status as enum
  ('requested', 'approved', 'rejected', 'purchased', 'delivered');
```

Table (abbreviated — see the migration for the full body, comments, CHECKs):

```sql
create table public.purchase_requests (
  id                 uuid primary key default gen_random_uuid(),
  work_package_id    uuid not null references public.work_packages(id) on delete cascade,
  -- requisition
  item_description   text not null,                       -- pr_item_nonblank
  quantity           numeric not null,                    -- pr_quantity_positive (numeric: fractional materials)
  unit               text not null,                       -- pr_unit_nonblank
  status             public.purchase_request_status not null default 'requested',
  source             text not null default 'app',         -- pr_source_valid: app|appsheet
  requested_by       uuid references public.users(id),    -- pr_native_has_requester when source='app'
  requested_by_email text,
  requested_at       timestamptz not null default now(),
  -- approval (native, PM/super)
  approved_by        uuid references public.users(id),
  decided_at         timestamptz,
  decision_comment   text,                                -- pr_reject_has_comment when status='rejected'
  -- purchase (AppSheet, P2)
  supplier           text, order_ref  text, amount        numeric, purchased_at timestamptz,
  -- delivery (AppSheet, P2)
  delivered_at       timestamptz, received_by text, delivery_note text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

Indexes:

- `purchase_requests_wp_idx` on `(work_package_id)` — "list requests for WP X".
- `purchase_requests_status_requested_at_idx` on `(status, requested_at desc)`
  — "top-level review queue: requests in status S, newest first."

`updated_at`: `before update` trigger calling the existing
`public.set_updated_at()` function (matches `users` / `work_packages`).

### RLS

Read ADR 0011 — every policy uses `public.current_user_role()`; never
self-join `public.users`.

```sql
-- SELECT: own rows (any role) OR reviewer roles (PM / procurement / super).
using (
  requested_by = auth.uid()
  or public.current_user_role() in ('project_manager','procurement','super_admin')
)

-- INSERT: wp-reader roles, requester pinned to self, native source pinned.
with check (
  public.current_user_role() in ('site_admin','project_manager','super_admin')
  and requested_by = auth.uid()
  and source = 'app'
)

-- UPDATE: PM / super only (column scoping done in the server action).
using      (public.current_user_role() in ('project_manager','super_admin'))
with check (public.current_user_role() in ('project_manager','super_admin'))
```

No DELETE policy — every DELETE through the application path affects zero
rows. Hard deletes require a service-role context.

Grants:

```sql
revoke all on public.purchase_requests from authenticated, anon;
grant select, insert, update on public.purchase_requests to authenticated;
```

Phase-2 AppSheet grants and `TO appsheet_writer` policies ship in P2 (see
ADR 0018), **not** here.

## Application

### `src/lib/purchasing/validate-purchase-request.ts` (pure, unit-tested)

```ts
export function validateCreatePurchaseRequest(input: {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
}): { ok: true; value: ValidatedPurchaseRequestInput } | { ok: false; error: string };

export type PurchaseDecision = "approved" | "rejected";
export function isPurchaseDecision(value: unknown): value is PurchaseDecision;
export function commentRequiredForDecision(decision: PurchaseDecision): boolean;
export function isDecisionCommentValid(decision: PurchaseDecision, comment: string | null): boolean;
```

Mirrors `validateDisplayName` in shape — trim + length checks return the
trimmed value so callers send the same string the CHECK constraints see.
`isDecisionCommentValid` mirrors the DB `pr_reject_has_comment` CHECK.

### `src/app/requests/actions.ts`

Session-client server actions (`"use server"`, `import "server-only"`).
Two functions:

- **`createPurchaseRequest({ workPackageId, itemDescription, quantity, unit })`**
  Validate via the pure helper; resolve the user via
  `supabase.auth.getUser()`; INSERT with `requested_by = user.id`,
  `source = 'app'`; `revalidatePath('/requests')`. RLS enforces role +
  requester-pin + native-source — no admin client.

- **`decidePurchaseRequest({ id, decision, comment? })`**
  Validate id shape + decision + comment-required predicate; resolve user;
  two-layer guarded UPDATE:
  ```ts
  .update({ status: decision, approved_by: user.id, decided_at: now, decision_comment })
  .eq('id', id)
  .eq('status', 'requested')
  .select('id');
  ```
  0 rows ⇒ "not in requested state." Mirrors `recordDecision` shape.

## TDD plan (test first — state "Writing failing test first")

1. **`supabase/tests/database/17-purchase-requests.test.sql`** (`plan(75)`).
   Sections:
   - A. Setup — 6 users (super_admin, site_admin × 2, project_manager,
     procurement, visitor), one project, one WP, four PR fixtures (one per
     SA + one for trigger test + one already-approved for guard test).
   - B. Catalog — enum + labels; table; PK / column types / nullability;
     status default `requested`; source default `app`; FKs to
     `work_packages.id`, `users.id` (×2); both indexes; trigger.
   - C. RLS — enabled; policies exactly SELECT / INSERT / UPDATE.
   - D. CHECK behavioural — blank `item_description` / `unit`, `quantity = 0`,
     `source='app'` + null `requested_by`, `status='rejected'` + null /
     whitespace `decision_comment`; PLUS positive case: AppSheet flow
     (`source='appsheet'` + null `requested_by` + email) lives_ok.
   - E. INSERT RLS under authenticated — SA self-insert OK; foreign
     `requested_by` denied (42501); `source='appsheet'` from JWT denied;
     PM / super_admin OK; procurement / visitor denied.
   - F. SELECT visibility — SA1 sees own, NOT SA2's; PM / procurement /
     super_admin see both; visitor sees nothing.
   - G. UPDATE RLS — PM `requested → approved`; PM `requested → rejected
with comment`; SA / procurement UPDATE no-ops; two-layer guard:
     `WHERE status='requested'` returns 0 rows on an already-approved
     row; `set_updated_at` trigger moves `updated_at` forward.
   - H. DELETE — PM / super_admin DELETE no-op (no policy).

2. **`tests/unit/validate-purchase-request.test.ts`** (21 cases).
   `validateCreatePurchaseRequest` happy path + trim + reject empty /
   whitespace / non-positive / NaN / Infinity / bad UUID; fractional
   quantity accepted. `PURCHASE_DECISIONS`, `isPurchaseDecision`,
   `commentRequiredForDecision`, `isDecisionCommentValid` predicates.

## Verification checklist

- [ ] Step 0 drift clean: `supabase db push --dry-run --linked` says
      "Remote database is up to date." Pre-existence check confirms
      `purchase_requests`, `purchase_request_status`, and any `appsheet*`
      role do NOT exist.
- [ ] `pnpm lint` clean.
- [ ] `pnpm typecheck` clean (manual `database.types.ts` patch in scope).
- [ ] `pnpm test` — 21 new validator/predicate tests pass; prior tests
      still pass.
- [ ] `git status`: only intended files (one new migration, one new pgTAP
      file, validator + actions + unit tests, this spec, new ADR 0022,
      ADR-0018 update, `database.types.ts` patch).
- [ ] **Post-merge** (delegated): `supabase db push --linked`; `pnpm db:test`
      — 75 new pgTAP assertions pass; `pnpm db:types` regenerates
      `database.types.ts` and the patch is superseded; post-apply
      `db push --dry-run` returns "up to date"; targeted check confirms
      `purchase_requests` + 3 policies + grants live on the linked DB.

## Scope — out (record; do not build)

- **UI / routes / components** — list, detail, request form, decision form.
  Ships in P1b.
- **`appsheet_writer` DB role, per-table grants, `TO appsheet_writer`
  policies, purchase / delivery write path.** Ships in P2 (gated on the
  ADR-0018 update landing — see below).
- **`users.email` bridge** for resolving `requested_by_email` back to a
  user row.
- **`audit_log` integration** — purchase-request lifecycle events not
  recorded in `audit_log` in P1a. Decide in P1b (the action layer that
  surfaces user-visible state changes) whether to start writing rows,
  and which transitions warrant them. Probably yes for decisions; leave
  the call for the unit that ships the UI.
- **Block-write triggers.** `purchase_requests` is STATEFUL; the
  append-only triple-enforcement pattern (REVOKE / RLS / trigger) does
  not apply.

## If blocked

When-blocked report + confidence %. In particular: do NOT silently swap
the dual-identity model, the role/visibility matrix, or the two-layer
guard pattern — all locked by ADR 0022.
