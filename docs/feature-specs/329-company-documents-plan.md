# Spec 329 — Company documents library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In THIS repo, additionally load the `ship-unit` skill per unit — its gates (lane claim, dependency gate-check, RED-first, real-flow verify, fresh-eyes, ship-pr.sh) wrap every task below.

**Goal:** Firm-level document library (หนังสือรับรองบริษัท, ภ.พ.20, company profile…) — append-only versioned table + private bucket + `/settings/company-docs` page with expiry badges, version history, and 7-day share links.

**Architecture:** ONE append-only table `company_documents` using the ADR 0004/0009 supersede chain for versions plus an ADR 0015 tombstone for retire (deliberate deviation from photo_logs' strict CHECK — see spec §2). Client uploads bytes via the browser client to the private `company-docs` bucket (storage INSERT policy gates), then a server action records the metadata row (table RLS gates). Downloads/share via service-role signed URLs (NO storage SELECT policy — house doctrine).

**Tech stack:** Next.js 16 App Router (Server Components default), Supabase (Postgres RLS + Storage), pgTAP, Vitest/RTL, pnpm.

## Global constraints

- TDD RED-first: the failing test is the first artifact of every task; announce "Writing failing test first."
- Repo unit gates apply per unit (CLAUDE.md "Unit gates") — this plan's tasks assume the `ship-unit` skill drives them.
- U1 = tasks 1–3 (ONE migration PR). U2 = tasks 4–7 (ONE code PR). Do not open more PRs than these two.
- Schema single-lane: task 2 claims migration number `20260813075816` — verify `ls supabase/migrations | tail -1` still shows `20260813075815_*` before writing; if not, renumber and update LANES.md.
- All Thai user-facing strings live in `src/lib/i18n/labels.ts` (SSOT). Raw Tailwind palette classes are banned — use the token classes shown verbatim below (`bg-card`, `border-edge`, `text-ink*`, `bg-attn-soft text-attn-ink`, `bg-danger-soft text-danger-ink`, `rounded-control`).
- TypeScript: `unknown` + narrow, never `any`. `exactOptionalPropertyTypes` is on.
- Never UPDATE/DELETE `company_documents` rows anywhere — supersede/tombstone INSERTs only (supersede-pattern skill).
- Commands run from the worktree root; Bash needs `export PATH="/c/Program Files/nodejs:$PATH"` and an explicit `cd` every command (cloud-PC quirk).
- Role names in SQL are hardcoded mirrors of the TS sets; if `BACK_OFFICE_ROLES` membership changed since 2026-07-19, re-read `src/lib/auth/role-home.ts:158` and update BOTH the migration SQL and `COMPANY_DOC_VIEW_ROLES`.

---

### Task 1: U1 pgTAP — RED

**Files:**

- Create: `supabase/tests/database/329-company-documents.test.sql`

**Interfaces:**

- Produces: the executable contract for task 2's migration (table shape, CHECK, unique child, freeze, RLS both directions, bucket, storage policy).

- [ ] **Step 1: Write the failing pgTAP file**

Model: `supabase/tests/database/323-rental-settlement-attachments.test.sql` (role-sim + `_tap_buf` grants + storage asserts) and `21b-storage-wpless-delivery.test.sql`. Content:

```sql
-- Spec 329 U1 — company_documents: append-only supersede + tombstone,
-- RLS (view roles read / accounting insert), private company-docs bucket,
-- storage INSERT policy. Runner form: begin → plan → asserts → finish → rollback.
begin;
select plan(25);

-- ── structure ────────────────────────────────────────────────
select has_table('public', 'company_documents', 'table exists');
select col_is_pk('public', 'company_documents', 'id', 'id is pk');
select col_type_is('public', 'company_documents', 'superseded_by', 'uuid', 'superseded_by uuid');
select has_check('public', 'company_documents', 'has check constraint');
select is(
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'company_documents'
      and indexdef like '%UNIQUE%superseded_by%'),
  1::bigint, 'partial unique index on superseded_by');

-- ── RLS enabled + policies exist ─────────────────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'public.company_documents'::regclass),
  true, 'RLS enabled');
select policies_are('public', 'company_documents',
  array['company documents readable by view roles',
        'company documents insert by accounting'],
  'exactly the two policies');

-- ── bucket private + storage INSERT policy pinned ────────────
select ok(
  exists(select 1 from storage.buckets where id = 'company-docs' and public = false),
  'company-docs bucket exists and is private');
select is(
  (select count(*) from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'company docs uploads by accounting'),
  1::bigint, 'storage INSERT policy exists');

-- ── seed two users (accounting + technician) ─────────────────
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4329-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spec329-acc@test.local'),
  ('00000000-0000-4329-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spec329-tech@test.local');
update public.users set role = 'accounting'
  where id = '00000000-0000-4329-a000-000000000001';
update public.users set role = 'technician'
  where id = '00000000-0000-4329-a000-000000000002';

-- runner collector must stay writable under role-sim (323 template)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ── accounting can INSERT (content row) ──────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000001"}';
select lives_ok($$
  insert into public.company_documents (id, title, storage_path, created_by)
  values ('00000000-0000-4329-d000-000000000001', 'หนังสือรับรองบริษัท',
          '00000000-0000-4329-d000-000000000001/cert.pdf',
          '00000000-0000-4329-a000-000000000001')
$$, 'accounting inserts a document');

-- version row: content + superseded_by TOGETHER is legal here (chain = history)
select lives_ok($$
  insert into public.company_documents (id, title, storage_path, superseded_by, created_by)
  values ('00000000-0000-4329-d000-000000000002', 'หนังสือรับรองบริษัท',
          '00000000-0000-4329-d000-000000000002/cert-2.pdf',
          '00000000-0000-4329-d000-000000000001',
          '00000000-0000-4329-a000-000000000001')
$$, 'content row may supersede (version chain)');

-- single-child: second superseder of the same row → unique violation
select throws_ok($$
  insert into public.company_documents (title, storage_path, superseded_by, created_by)
  values ('x', 'x/x.pdf', '00000000-0000-4329-d000-000000000001',
          '00000000-0000-4329-a000-000000000001')
$$, '23505', null, 'a row can be superseded once');

-- tombstone (retire): all payload NULL + superseded_by set
select lives_ok($$
  insert into public.company_documents (superseded_by, created_by)
  values ('00000000-0000-4329-d000-000000000002',
          '00000000-0000-4329-a000-000000000001')
$$, 'tombstone retires the head');

-- malformed shapes rejected by the well-formedness CHECK
select throws_ok($$
  insert into public.company_documents (created_by)
  values ('00000000-0000-4329-a000-000000000001')
$$, '23514', null, 'all-NULL row without supersede rejected');
select throws_ok($$
  insert into public.company_documents (storage_path, created_by)
  values ('y/y.pdf', '00000000-0000-4329-a000-000000000001')
$$, '23514', null, 'payload without title rejected');

-- accounting reads what it wrote
select is(
  (select count(*) from public.company_documents),
  3::bigint, 'accounting sees all rows');

-- current-set read (both filters) returns nothing (chain fully retired)
select is(
  (select count(*) from public.company_documents d
    where d.storage_path is not null
      and not exists (select 1 from public.company_documents newer
                      where newer.superseded_by = d.id)),
  0::bigint, 'retired chain leaves the current set');

-- ── technician: read denied, insert denied ───────────────────
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000002"}';
select is((select count(*) from public.company_documents), 0::bigint,
  'technician sees zero rows');
select throws_ok($$
  insert into public.company_documents (title, storage_path, created_by)
  values ('z', 'z/z.pdf', '00000000-0000-4329-a000-000000000002')
$$, '42501', null, 'technician insert denied');

-- ── storage: accounting upload allowed, technician denied ────
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000001"}';
select lives_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('company-docs', '00000000-0000-4329-d000-000000000001/cert.pdf',
          '00000000-0000-4329-a000-000000000001')
$$, 'accounting uploads into company-docs');
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('company-docs', 'a/b/c.pdf',
          '00000000-0000-4329-a000-000000000001')
$$, '42501', null, 'nested path rejected (one-folder shape)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000002"}';
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('company-docs', 'x/x.pdf', '00000000-0000-4329-a000-000000000002')
$$, '42501', null, 'technician upload denied');
reset role;

-- ── append-only freeze ───────────────────────────────────────
select throws_ok(
  $$update public.company_documents set note = 'nope'
    where id = '00000000-0000-4329-d000-000000000001'$$,
  'P0001', null, 'UPDATE blocked');
select throws_ok(
  $$delete from public.company_documents
    where id = '00000000-0000-4329-d000-000000000001'$$,
  'P0001', null, 'DELETE blocked');
select is(
  (select count(*) from pg_trigger
    where tgrelid = 'public.company_documents'::regclass and not tgisinternal),
  2::bigint, 'both freeze triggers present');

select * from finish();
rollback;
```

Count the asserts and set `plan(N)` to the real number before running (the block above totals 25 — recount after any edit).

- [ ] **Step 2: Run to verify RED**

```bash
cd /d/claude/projects/prc-ops/prc-ops-329docs && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:test 2>&1 | grep -A5 "329"
```

Expected: `329-company-documents` FAILS (`has_table ... failed`). Pre-existing known-red `221-catalog` only — anything else red, stop and investigate (shared DB; see LANES STATUS).

- [ ] **Step 3: Commit (test only)**

```bash
git add supabase/tests/database/329-company-documents.test.sql && git commit -m "test: spec 329 U1 pgTAP — company_documents contract (RED)"
```

---

### Task 2: U1 migration — GREEN

**Files:**

- Create: `supabase/migrations/20260813075816_spec329_company_documents.sql`
- Regenerate: `src/lib/db/database.types.ts` (via `pnpm db:types`)

**Interfaces:**

- Produces: table `public.company_documents` (columns per spec §2), bucket `company-docs`, policies named exactly `company documents readable by view roles`, `company documents insert by accounting`, `company docs uploads by accounting`. Tasks 4–6 consume the generated row type `Tables<"company_documents">`.

- [ ] **Step 1: Verify the lane + number**

`require-lane-claim` hook blocks migration writes unless the branch is claimed in `../LANES.md` — claim the U1 branch there first (schema claimant `075816`). Confirm `ls supabase/migrations | tail -1` → `20260813075815_spec328_subcon_member_onboarding.sql`.

- [ ] **Step 2: Write the migration**

```sql
-- Spec 329 U1 — company documents library (เอกสารบริษัท).
-- Append-only supersede table: ADR 0004/0009 chain (content rows MAY supersede —
-- the chain is the version history) + ADR 0015 tombstone for retire (all payload
-- NULL + superseded_by set). Deliberate deviation from photo_logs' strict
-- (storage_path IS NULL) = (superseded_by IS NOT NULL) check — spec 329 §2.
-- Reads: table SELECT for view roles; bucket has INSERT policy ONLY (downloads
-- via service-role signed URLs — pr-attachments/contact-docs doctrine).

create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  title text,
  note text,
  storage_path text,
  issued_at date,
  expires_at date,
  superseded_by uuid references public.company_documents(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint company_documents_title_bounds check (
    title is null or length(btrim(title)) between 1 and 200
  ),
  constraint company_documents_well_formed check (
    (storage_path is not null and title is not null)
    or (storage_path is null and title is null and note is null
        and issued_at is null and expires_at is null
        and superseded_by is not null)
  )
);

comment on table public.company_documents is
  'Spec 329: firm-level documents (append-only; version = superseding content row, retire = tombstone).';

-- single-child chain + the anti-join index the supersede skill requires
create unique index company_documents_superseded_by_key
  on public.company_documents (superseded_by)
  where superseded_by is not null;

-- append-only, three layers (photo_logs doctrine): revoke, no policies, trigger
revoke update, delete, truncate on public.company_documents from anon, authenticated;

create function public.company_documents_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'company_documents is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger company_documents_block_update_delete
  before update or delete on public.company_documents
  for each row execute function public.company_documents_block_write();

create trigger company_documents_block_truncate
  before truncate on public.company_documents
  for each statement execute function public.company_documents_block_write();

alter table public.company_documents enable row level security;

-- fail-closed: coalesce(...) so a roleless JWT (current_user_role() NULL)
-- lands on FALSE, never NULL (rls_null_safe_role_wrappers lesson).
create policy "company documents readable by view roles"
  on public.company_documents
  for select
  to authenticated
  using (
    coalesce(public.current_user_role() in
      ('project_manager', 'super_admin', 'procurement', 'procurement_manager',
       'project_director', 'accounting', 'legal'), false)
  );

create policy "company documents insert by accounting"
  on public.company_documents
  for insert
  to authenticated
  with check (
    coalesce(public.current_user_role() in ('accounting', 'super_admin'), false)
    and created_by = auth.uid()
  );

-- private bucket (contact-docs template) — PDFs + the photo formats
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-docs',
  'company-docs',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- INSERT only; one-folder path <document_row_id>/<filename>. NO SELECT/UPDATE/
-- DELETE policies — reads are service-role signed URLs; orphans accepted.
create policy "company docs uploads by accounting"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-docs'
    and coalesce(public.current_user_role() in ('accounting', 'super_admin'), false)
    and array_length(storage.foldername(objects.name), 1) = 1
  );
```

- [ ] **Step 3: Push + verify GREEN**

```bash
cd /d/claude/projects/prc-ops/prc-ops-329docs && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:push && pnpm db:test 2>&1 | tail -20
```

Expected: `329-company-documents` all-pass; suite total = previous + this file; only `221-catalog` known-red. Pooler `ECIRCUITBREAKER` flakes → re-run once before diagnosing.

- [ ] **Step 4: Regenerate types + typecheck**

```bash
cd /d/claude/projects/prc-ops/prc-ops-329docs && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:types && pnpm typecheck
```

Expected: `database.types.ts` gains `company_documents`; typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813075816_spec329_company_documents.sql src/lib/db/database.types.ts && git commit -m "feat: spec 329 U1 — company_documents table + company-docs bucket + RLS"
```

---

### Task 3: Ship U1

- [ ] **Step 1: Fresh-eyes review** — reviewer subagent over the full diff (migration + pgTAP); address every finding with verification, not agreement.
- [ ] **Step 2: Ship**

```bash
cd /d/claude/projects/prc-ops/prc-ops-329docs && export PATH="/c/Program Files/nodejs:$PATH" && bash scripts/ship-pr.sh "feat: spec 329 U1 — company_documents schema + bucket + RLS" "Additive migration 20260813075816 ... (danger-path guard red BY DESIGN; additive-mig self-merge grant applies on green substantive checks)"
```

Danger-path guard fails on every migration PR by design. When ALL substantive checks are green (Build, pgTAP, Lint-TC-Test, Secret, Worker), admin-merge under the standing additive-migration grant (`gh pr merge <N> --squash --admin`). Destructive it is not (pure CREATE).

- [ ] **Step 3: Close the lane step** — LANES.md: record mig `075816` LIVE, schema lane FREE, next `075817`; delete merged branch.

---

### Task 4: U2 pure libs — expiry + chain grouping (RED-first)

**Files:**

- Create: `src/lib/company-docs/expiry.ts`, `src/lib/company-docs/group-documents.ts`
- Test: `tests/unit/company-docs-lib.test.ts`

**Interfaces:**

- Produces:
  - `expiryStatus(expiresAt: string | null, today: Date): "expired" | "expiring" | "ok" | "none"` (30-day window)
  - `groupDocuments(rows: CompanyDocumentRow[]): CompanyDocument[]` where `CompanyDocumentRow = Tables<"company_documents">` and `interface CompanyDocument { head: CompanyDocumentRow; history: CompanyDocumentRow[] }` (history newest-first, tombstone-headed chains excluded)
- Consumes: `Tables<"company_documents">` from task 2.

- [ ] **Step 1: Writing failing test first**

```ts
import { describe, expect, it } from "vitest";
import { expiryStatus } from "@/lib/company-docs/expiry";
import { groupDocuments } from "@/lib/company-docs/group-documents";
import type { Tables } from "@/lib/db/database.types";

type Row = Tables<"company_documents">;
const base = (over: Partial<Row>): Row => ({
  id: "a",
  title: "t",
  note: null,
  storage_path: "a/f.pdf",
  issued_at: null,
  expires_at: null,
  superseded_by: null,
  created_by: "u",
  created_at: "2026-07-01T00:00:00Z",
  ...over,
});
const today = new Date("2026-07-19T00:00:00Z");

describe("expiryStatus", () => {
  it("none without a date", () => expect(expiryStatus(null, today)).toBe("none"));
  it("expired when past", () => expect(expiryStatus("2026-06-15", today)).toBe("expired"));
  it("expiring within 30 days", () => expect(expiryStatus("2026-08-10", today)).toBe("expiring"));
  it("ok beyond 30 days", () => expect(expiryStatus("2026-12-12", today)).toBe("ok"));
  it("expiring on the boundary day 30", () =>
    expect(expiryStatus("2026-08-18", today)).toBe("expiring"));
});

describe("groupDocuments", () => {
  it("A<-B<-C chain yields head C with history [B, A]", () => {
    const rows = [
      base({ id: "A" }),
      base({ id: "B", superseded_by: "A", storage_path: "B/f.pdf" }),
      base({ id: "C", superseded_by: "B", storage_path: "C/f.pdf" }),
    ];
    const docs = groupDocuments(rows);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.head.id).toBe("C");
    expect(docs[0]?.history.map((r) => r.id)).toEqual(["B", "A"]);
  });
  it("tombstone head hides the chain", () => {
    const rows = [
      base({ id: "A" }),
      base({ id: "T", superseded_by: "A", storage_path: null, title: null }),
    ];
    expect(groupDocuments(rows)).toHaveLength(0);
  });
  it("standalone doc has empty history", () => {
    expect(groupDocuments([base({ id: "A" })])[0]?.history).toEqual([]);
  });
});
```

- [ ] **Step 2: RED** — `pnpm test tests/unit/company-docs-lib.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement**

`src/lib/company-docs/expiry.ts`:

```ts
// Spec 329 §6 — visual-only expiry states; 30-day warning window.
export type ExpiryStatus = "expired" | "expiring" | "ok" | "none";

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function expiryStatus(expiresAt: string | null, today: Date): ExpiryStatus {
  if (expiresAt === null) return "none";
  const expiry = new Date(`${expiresAt}T00:00:00Z`);
  const days = Math.floor((expiry.getTime() - today.getTime()) / DAY_MS);
  if (days < 0) return "expired";
  if (days <= WINDOW_DAYS) return "expiring";
  return "ok";
}
```

`src/lib/company-docs/group-documents.ts`:

```ts
// Spec 329 §2 — current set + per-doc history from the append-only rows.
// Anti-join done in memory (PostgREST can't express EXISTS) — the
// current-photos.ts precedent. Both ADR 0015 filters: a head that is a
// tombstone (storage_path NULL) is a retired chain and is dropped whole.
import type { Tables } from "@/lib/db/database.types";

export type CompanyDocumentRow = Tables<"company_documents">;
export interface CompanyDocument {
  head: CompanyDocumentRow;
  history: CompanyDocumentRow[];
}

export function groupDocuments(rows: CompanyDocumentRow[]): CompanyDocument[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const supersededIds = new Set<string>();
  for (const r of rows) if (r.superseded_by !== null) supersededIds.add(r.superseded_by);
  const docs: CompanyDocument[] = [];
  for (const r of rows) {
    if (supersededIds.has(r.id)) continue;
    if (r.storage_path === null) continue;
    const history: CompanyDocumentRow[] = [];
    let cur = r.superseded_by === null ? undefined : byId.get(r.superseded_by);
    while (cur !== undefined) {
      history.push(cur);
      cur = cur.superseded_by === null ? undefined : byId.get(cur.superseded_by);
    }
    docs.push({ head: r, history });
  }
  return docs;
}
```

- [ ] **Step 4: GREEN** — same test command, all pass.
- [ ] **Step 5: Commit** — `git add src/lib/company-docs tests/unit/company-docs-lib.test.ts && git commit -m "feat: spec 329 U2 — expiry + supersede-chain grouping libs"`

---

### Task 5: U2 role set, bucket constant, server actions, client upload (RED-first)

**Files:**

- Modify: `src/lib/auth/role-home.ts` (after `ACCOUNTING_ROLES`, `:321`), `src/lib/storage/buckets.ts`
- Create: `src/lib/company-docs/actions.ts`, `src/lib/company-docs/upload-company-doc.ts`, `src/lib/company-docs/list-documents.ts`
- Test: `tests/unit/company-docs-actions.test.ts`

**Interfaces:**

- Consumes: `requireActionRole(allowed): Promise<{auth:{supabase,user}}|{error:string}>` (`src/lib/auth/action-gate.ts:50`); admin client `createClient()` from `@/lib/db/admin`; browser client from `@/lib/db/browser`; `groupDocuments` from task 4.
- Produces (tasks 6–7 rely on these exact names):
  - `COMPANY_DOC_VIEW_ROLES: ReadonlyArray<UserRole>` (role-home.ts)
  - `COMPANY_DOCS_BUCKET = "company-docs"` (buckets.ts)
  - `addCompanyDocument(input: {id: string; title: string; note: string | null; issuedAt: string | null; expiresAt: string | null; storagePath: string}): Promise<{ok: true} | {error: string}>`
  - `addCompanyDocumentVersion(input: same & {supersedes: string}): Promise<{ok: true} | {error: string}>`
  - `retireCompanyDocument(input: {headId: string}): Promise<{ok: true} | {error: string}>`
  - `mintCompanyDocShareLink(input: {storagePath: string}): Promise<{url: string} | {error: string}>` (TTL 604800s)
  - `uploadCompanyDocFile(file: File): Promise<{id: string; path: string} | {error: string}>` (client; mints `crypto.randomUUID()`, path `${id}/${sanitized}`)
  - `listCompanyDocuments(): Promise<CompanyDocument[]>` (server read via user-context client, ordered `created_at desc`)

- [ ] **Step 1: Role set + bucket constant**

`role-home.ts`, directly under `ACCOUNTING_ROLES` (line ~321):

```ts
// Spec 329: who can OPEN /settings/company-docs (read/download/share the firm's
// documents). Wider than BACK_OFFICE_ROLES on purpose (accounting + legal in);
// manage stays ACCOUNTING_ROLES. New meaning → its own set (role doctrine).
export const COMPANY_DOC_VIEW_ROLES: ReadonlyArray<UserRole> = [
  ...BACK_OFFICE_ROLES,
  "accounting",
  "legal",
];
```

`buckets.ts` append: `// Spec 329 — firm-level documents (private; accounting upload).` + `export const COMPANY_DOCS_BUCKET = "company-docs";`

- [ ] **Step 2: Writing failing test first** (`tests/unit/company-docs-actions.test.ts`) — model on `tests/unit/legal-contracts-actions.test.ts` (mock `@/lib/auth/action-gate` + `@/lib/db/admin`): asserts (a) `addCompanyDocument` refuses when gate returns `{error}`; (b) inserts row with `created_by = user.id` and the passed fields; (c) `addCompanyDocumentVersion` sets `superseded_by = supersedes`; (d) `retireCompanyDocument` inserts all-payload-NULL row + `superseded_by = headId`; (e) `mintCompanyDocShareLink` calls `createSignedUrl(path, 604800)` and is gated by `COMPANY_DOC_VIEW_ROLES` (not ACCOUNTING). Write the concrete mocks by copying the legal test's harness verbatim and swapping the module under test.
- [ ] **Step 3: RED** — `pnpm test tests/unit/company-docs-actions.test.ts` fails (module missing).
- [ ] **Step 4: Implement `actions.ts`**

```ts
"use server";
// Spec 329 — metadata writes (table RLS gates again server-side) + share link.
// Bytes are uploaded client-side (upload-company-doc.ts); these actions only
// record rows / mint URLs. Supersede-pattern skill applies: INSERTs only.
import { requireActionRole } from "@/lib/auth/action-gate";
import { ACCOUNTING_ROLES, COMPANY_DOC_VIEW_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { COMPANY_DOCS_BUCKET } from "@/lib/storage/buckets";
import { revalidatePath } from "next/cache";

const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;

interface DocInput {
  id: string;
  title: string;
  note: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  storagePath: string;
}

async function insertDocument(
  input: DocInput,
  supersedes: string | null,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireActionRole(ACCOUNTING_ROLES);
  if ("error" in gate) return { error: gate.error };
  const { supabase, user } = gate.auth;
  const { error } = await supabase.from("company_documents").insert({
    id: input.id,
    title: input.title,
    note: input.note,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    storage_path: input.storagePath,
    superseded_by: supersedes,
    created_by: user.id,
  });
  if (error) return { error: `บันทึกเอกสารไม่สำเร็จ: ${error.message}` };
  revalidatePath("/settings/company-docs");
  return { ok: true };
}

export async function addCompanyDocument(input: DocInput) {
  return insertDocument(input, null);
}

export async function addCompanyDocumentVersion(input: DocInput & { supersedes: string }) {
  return insertDocument(input, input.supersedes);
}

export async function retireCompanyDocument(input: { headId: string }) {
  const gate = await requireActionRole(ACCOUNTING_ROLES);
  if ("error" in gate) return { error: gate.error };
  const { supabase, user } = gate.auth;
  const { error } = await supabase.from("company_documents").insert({
    superseded_by: input.headId,
    created_by: user.id,
  });
  if (error) return { error: `ถอนเอกสารไม่สำเร็จ: ${error.message}` };
  revalidatePath("/settings/company-docs");
  return { ok: true };
}

export async function mintCompanyDocShareLink(input: { storagePath: string }) {
  const gate = await requireActionRole(COMPANY_DOC_VIEW_ROLES);
  if ("error" in gate) return { error: gate.error };
  const { data, error } = await createAdminClient()
    .storage.from(COMPANY_DOCS_BUCKET)
    .createSignedUrl(input.storagePath, SHARE_TTL_SECONDS);
  if (error !== null || data === null) {
    return { error: "สร้างลิงก์ไม่สำเร็จ กรุณาลองใหม่" };
  }
  return { url: data.signedUrl };
}
```

Gate-check during implementation: confirm admin module's export really is `createClient` (`src/lib/db/admin.ts:8`) and the storage API is `createSignedUrl` (singular, path+TTL) on the installed supabase-js.

- [ ] **Step 5: Implement `upload-company-doc.ts`** (client, mirrors `src/lib/expenses/upload-expense-receipt.ts:42`):

```ts
// Spec 329 — client-side byte upload; the storage INSERT policy is the gate.
// Path = <row-id>/<sanitized name>; the same id then becomes the table row id.
import { createClient } from "@/lib/db/browser";
import { COMPANY_DOCS_BUCKET } from "@/lib/storage/buckets";

const NAME_MAX = 120;

export function sanitizeDocFilename(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}.\-_]+/gu, "-").replace(/^-+|-+$/g, "");
  return (cleaned === "" ? "document" : cleaned).slice(0, NAME_MAX);
}

export async function uploadCompanyDocFile(
  file: File,
): Promise<{ id: string; path: string } | { error: string }> {
  const id = crypto.randomUUID();
  const path = `${id}/${sanitizeDocFilename(file.name)}`;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(COMPANY_DOCS_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error !== null) return { error: `อัปโหลดไฟล์ไม่สำเร็จ: ${error.message}` };
  return { id, path };
}
```

- [ ] **Step 6: Implement `list-documents.ts`** (server read):

```ts
import "server-only";
// Spec 329 — user-context read; table RLS is the gate. Grouping in memory
// (group-documents.ts) per the current-photos anti-join precedent.
import { createClient } from "@/lib/db/server";
import { groupDocuments, type CompanyDocument } from "./group-documents";

export async function listCompanyDocuments(): Promise<CompanyDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`company_documents read failed: ${error.message}`);
  return groupDocuments(data ?? []);
}
```

- [ ] **Step 7: GREEN + typecheck** — actions test passes; `pnpm typecheck` 0.
- [ ] **Step 8: Commit** — `feat: spec 329 U2 — role set, actions, upload + list helpers`

---

### Task 6: U2 UI — labels, components, page, doors, guards (RED-first)

**Files:**

- Modify: `src/lib/i18n/labels.ts`, `src/app/settings/sections.ts`, `src/app/accounting/page.tsx`
- Create: `src/app/settings/company-docs/page.tsx`, `src/components/features/company-docs/company-docs-view.tsx`, `src/components/features/company-docs/company-doc-sheets.tsx`, `src/components/features/company-docs/share-link-button.tsx`
- Test: `tests/unit/company-docs-view.test.tsx`; modify `tests/unit/settings-sections.test.ts`, `tests/unit/nav-back-affordance.test.ts` (`STATIC_DETAIL` += `"settings/company-docs"`), `tests/unit/feature-components-structure.test.ts` (`ALLOWED_DOMAINS` += `"company-docs"`)

**Interfaces:**

- Consumes: everything from tasks 4–5 by the exact names above; `requireRole` (`src/lib/auth/require-role.ts:79`); `mintSignedUrls(bucket, rows): Promise<Map<string,string>>` (`src/lib/storage/signed-urls.ts:26`, 120s TTL — page download links); `BottomSheet` (`@/components/features/common/bottom-sheet`); chrome components as used by `src/app/settings/org-chart/page.tsx` (PageShell, DetailHeader, BottomTabBar, PAGE_MAX_W).

- [ ] **Step 1: Labels block** (`labels.ts`, append in the settings region):

```ts
// Spec 329 — company documents library (เอกสารบริษัท).
export const COMPANY_DOCS_LABEL = "เอกสารบริษัท";
export const COMPANY_DOCS_HINT = "หนังสือรับรอง · ภ.พ.20 · โปรไฟล์บริษัท";
export const COMPANY_DOC_UPLOAD_LABEL = "อัปโหลดเอกสาร";
export const COMPANY_DOC_NEW_VERSION_LABEL = "เวอร์ชันใหม่";
export const COMPANY_DOC_RETIRE_LABEL = "ถอนเอกสารออก";
export const COMPANY_DOC_SHARE_LABEL = "แชร์ลิงก์";
export const COMPANY_DOC_SHARE_COPIED_LABEL = "คัดลอกลิงก์แล้ว (ใช้ได้ 7 วัน)";
export const COMPANY_DOC_DOWNLOAD_LABEL = "ดาวน์โหลด";
export const COMPANY_DOC_HISTORY_LABEL = "ประวัติเวอร์ชัน";
export const COMPANY_DOC_EXPIRED_LABEL = "หมดอายุ";
export const COMPANY_DOC_EXPIRING_LABEL = "ใกล้หมดอายุ";
export const COMPANY_DOC_ISSUED_LABEL = "วันที่ออกเอกสาร";
export const COMPANY_DOC_EXPIRES_LABEL = "วันหมดอายุ";
export const COMPANY_DOC_TITLE_LABEL = "ชื่อเอกสาร";
export const COMPANY_DOC_EMPTY_LABEL = "ยังไม่มีเอกสารบริษัท";
```

- [ ] **Step 2: Writing failing test first** (`tests/unit/company-docs-view.test.tsx`, RTL): (a) renders one card per doc with title; (b) `canManage: false` hides อัปโหลดเอกสาร / เวอร์ชันใหม่ / ถอนเอกสารออก but keeps ดาวน์โหลด + แชร์ลิงก์; (c) expired doc shows หมดอายุ badge, expiring shows ใกล้หมดอายุ, no badge otherwise; (d) history entries render inside ประวัติเวอร์ชัน with their download links; (e) empty list renders COMPANY_DOC_EMPTY_LABEL. Use `groupDocuments` fixtures from task 4's shapes; pass `downloadUrls: Record<string, string>`. Under load, RTL `waitFor` flakes → `await act()` flush (usetransition-test-flake lesson).
- [ ] **Step 3: RED**, then implement components:
  - `company-docs-view.tsx` (`"use client"`): props `{ docs: CompanyDocument[]; downloadUrls: Record<string, string>; canManage: boolean; todayIso: string }`. Card markup follows the store row idiom: `border-edge bg-card rounded-control flex ... border p-3`; badges: expired `bg-danger-soft text-danger-ink text-meta rounded-full px-2 py-0.5 font-medium`, expiring `bg-attn-soft text-attn-ink ...` (verbatim class strings from `material-log-view.tsx`). Dates via `formatThaiDate` from labels. History = `<details>` disclosure listing history rows with their `downloadUrls` links. Manage buttons render only when `canManage`.
  - `company-doc-sheets.tsx` (`"use client"`): one `BottomSheet` hosting the upload form (file input `accept="application/pdf,image/jpeg,image/png,image/webp"`, title, note, issued_at, expires_at date inputs) used in two modes — new doc, new version (mode carries `supersedes` + prefilled title/note). Submit: `uploadCompanyDocFile(file)` → on `{id, path}` call `addCompanyDocument({id, ..., storagePath: path})` or `addCompanyDocumentVersion({..., supersedes})` → `router.refresh()` + close; surface `{error}` inline (`text-danger text-meta`). Retire = confirm block inside the card's manage area calling `retireCompanyDocument`.
  - `share-link-button.tsx` (`"use client"`): button → `mintCompanyDocShareLink({storagePath})` → `navigator.clipboard.writeText(url)` → flip label to COMPANY_DOC_SHARE_COPIED_LABEL for 3s; error state inline.
- [ ] **Step 4: Page** `src/app/settings/company-docs/page.tsx` (server, org-chart twin): `const ctx = await requireRole(COMPANY_DOC_VIEW_ROLES);` → `listCompanyDocuments()` → collect head+history rows → `mintSignedUrls(COMPANY_DOCS_BUCKET, rows)` → `Object.fromEntries(map)` → render `DetailHeader` (back `/settings`, title COMPANY_DOCS_LABEL) + `<CompanyDocsView docs=... downloadUrls=... canManage={ACCOUNTING_ROLES.includes(ctx.role)} todayIso=.../>`. `todayIso` = `new Date().toISOString().slice(0, 10)` computed server-side so the client component stays deterministic under test.
- [ ] **Step 5: Doors** — `sections.ts`: add to the section that already holds the `/accounting` door: `{ kind: "link", href: "/settings/company-docs", icon: FileText, label: COMPANY_DOCS_LABEL, hint: COMPANY_DOCS_HINT, visible: (role) => COMPANY_DOC_VIEW_ROLES.includes(role) }`. `accounting/page.tsx` door array += `{ href: "/settings/company-docs", label: COMPANY_DOCS_LABEL, hint: COMPANY_DOCS_HINT }`.
- [ ] **Step 6: Guard updates (deliberate, not weakened):** settings-sections matrix arrays gain the new href for every role in COMPANY_DOC_VIEW_ROLES ∩ that test's role fixtures; `STATIC_DETAIL` += `"settings/company-docs"`; `ALLOWED_DOMAINS` += `"company-docs"`.
- [ ] **Step 7: GREEN + full gates** — `pnpm test tests/unit/company-docs-view.test.tsx`, then `pnpm lint && pnpm typecheck && pnpm test` (full suite; expect prior total + new files, zero new reds).
- [ ] **Step 8: Commit** — `feat: spec 329 U2 — /settings/company-docs page, sheets, doors, labels`

---

### Task 7: U2 verify + ship

- [ ] **Step 1: Real-flow browser verify** (dev-preview login recipe, memory `dev-preview-login`; dev server via preview tools, NEVER bash):
  1. As dev-preview super_admin: open `/settings` → เอกสารบริษัท entry visible → open page.
  2. Upload a real PDF (title หนังสือรับรองบริษัท, expiry inside 30d) → card appears with ใกล้หมดอายุ badge.
  3. เวอร์ชันใหม่ on it → history shows 1 superseded row, both downloadable (URLs work).
  4. แชร์ลิงก์ → clipboard URL opens the file in a logged-out tab (signed URL proof).
  5. ถอนเอกสารออก on a second test doc → gone from list.
  6. View-as `procurement` (SSR probe per wedge-proof pattern): page 200, list renders, manage controls ABSENT (grep the SSR HTML for อัปโหลดเอกสาร = 0 hits).
  7. View-as `technician`: redirected (requireRole refusal).
  8. Zero console/server errors. Clean up test rows: they are append-only — retire the test doc chains (tombstones are fine to leave; note ids in the lane block) and note that Storage orphans are accepted by design.
- [ ] **Step 2: Fresh-eyes review** — full U2 diff; address findings.
- [ ] **Step 3: Ship** — `bash scripts/ship-pr.sh "feat: spec 329 U2 — company documents library UI" "..."`. PR touches `src/lib/auth/role-home.ts` → danger-path guard HOLDS by design → flag the operator for one-tap merge (attended: in-chat; unattended: 🔔 Telegram).
- [ ] **Step 4: Close the loop** — LANES: move lane block to archive on merge + STATUS line; memory: new topic file `spec329-company-documents.md` + index pointer + archive-index when done; progress tracker per repo Feature workflow.

---

## Plan self-review notes

- Spec coverage: §1 access (T5 role set + T2 policies), §2 data (T1/T2), §3 storage (T2 + T5 upload), §4 surfaces (T6), §5 share (T5 action + T6 button), §6 expiry (T4 + T6 badges), §7 non-goals honored (no category/no notifications/no delete anywhere above), §8 units = U1 (T1–3) / U2 (T4–7).
- pgTAP `plan(N)`: recount before first run; the listed block totals 25 asserts.
- Types consistent: `CompanyDocument`/`CompanyDocumentRow` defined once in `group-documents.ts`, imported elsewhere; action names identical across tasks 5–6.
- Known risk: `policies_are` on a table with only 2 policies is strict — if a later spec adds a policy, that assert reds deliberately (guard-trip map class).
