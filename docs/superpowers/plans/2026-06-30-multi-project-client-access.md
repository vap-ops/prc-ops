# Multi-project client access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `client` portal login can hold live access to N projects (explicit per-project grant); `/client` lists the live projects and drills into each.

**Architecture:** No new tables or RLS — `client_portal_access` already allows N rows per login and `client_has_live_access` + the four read arms are already per-project (spec 233 / ADR 0067). U1 adds a `grant_client_access` RPC and relaxes `claim_client_invite` to be re-entrant (visitor OR client; `ON CONFLICT DO UPDATE` un-revokes). U2 turns `/client` into a project list → `/client/[projectId]` drill and makes `loadClientView` take a project arg. U3 adds a PD "grant an existing client login" picker on the project page.

**Tech Stack:** Next.js 16 App Router (Server Components), Supabase Postgres + RLS + `security definer` RPCs, pgTAP (`pnpm db:test`), Vitest. Package manager **pnpm**.

**Spec:** `docs/feature-specs/234-multi-project-client-access.md` (read it first).

## Global Constraints

- **TDD, test-first.** First action of every unit is the failing test. State "Writing failing test first." No production code before a red test (CLAUDE.md).
- **"Client" = the portal LOGIN** — a `public.users` row of role `client`, a person by LINE display name, bound via `client_portal_access.user_id`. NEVER the CRM `clients` company. Every grant path operates on a login.
- **Source the live `claim_client_invite` body** (`pg_get_functiondef`) before redefining it — never hand-invent (DB-migration-lessons law). DROP+CREATE, not CREATE OR REPLACE blind.
- **Definer RPCs:** `security definer` + `set search_path = public`; `revoke execute from public, anon`; `grant execute to authenticated`; null-safe role gate (`coalesce(current_user_role() in (...), false)`).
- **No money, ever, in any client query.** `loadClientView` selects only safe columns (never `budget_amount_thb`).
- **Issuer/grantor gate = `CLIENT_ISSUER_ROLES`** (`project_director` + `super_admin`, already exported from `role-home.ts`). NOT PM.
- **Schema single-lane.** U1 touches `supabase/migrations/`. Claim the lane in `D:\claude\projects\prc-ops\LANES.md` (migration ts = current-max + 1000 = `20260813038000`) before `db:push`.
- **Danger-path = operator-held / PAT.** U1 (migration + RPC redefinition) holds for the operator / PAT-merge. U2 + U3 are code-only → auto-merge on green.
- **Thai-first UI**, `src/lib/ui/classes` tokens, Server Components by default.
- **Per repo workflow:** update `docs/progress-tracker.md` at start/end of each unit; run `pnpm lint && pnpm typecheck && pnpm test` (+ `pnpm db:test` for U1) before pushing; ship via `scripts/ship-pr.sh`.

---

## File Structure

**U1 — schema**
- Create: `supabase/migrations/20260813038000_multi_project_client_access.sql` (grant RPC + re-entrant claim, DROP+CREATE)
- Create: `supabase/tests/database/<n>_multi_project_client.sql` (pgTAP; `<n>` = current max test number + 1)
- Modify: `src/lib/db/database.types.ts` + `worker/src/database.types.ts` (`pnpm db:types`)

**U2 — `/client` multi-project render**
- Modify: `src/lib/client-portal/load-client-view.ts` (`loadClientView(supabase, projectId)`)
- Create: `src/lib/client-portal/load-client-projects.ts` (`loadClientProjects(supabase)`)
- Create: `src/app/client/[projectId]/page.tsx` (drill)
- Create: `src/components/features/client-portal/client-project-list.tsx`
- Modify: `src/components/features/client-portal/client-progress-view.tsx` (optional `backHref` → back chip)
- Modify: `src/app/client/page.tsx` (0 → access-ended; 1 → render; ≥2 → list)
- Modify: `src/app/client/claim/page.tsx` (let a signed-in client WITH a token claim)
- Modify: `tests/unit/load-client-view.test.ts` (projectId arg)
- Create: `tests/unit/load-client-projects.test.ts`
- Modify: `tests/unit/nav-back-affordance.test.ts` (treat the `/client` tree as bespoke external)

**U3 — PD direct-pick grant**
- Modify: `src/app/projects/[projectId]/actions.ts` (`grantClientAccess`)
- Create: `src/components/features/client-portal/client-grant-existing.tsx`
- Modify: `src/app/projects/[projectId]/page.tsx` (load candidate client logins; render the control)
- Modify: `tests/unit/client-portal-actions.test.ts` (grantClientAccess)
- Create: `tests/unit/client-grant-existing.test.tsx`

---

## Task U1: schema — grant RPC + re-entrant claim

**Files:** as listed under U1. Requires the schema lane.

**Interfaces:**
- Produces (SQL): `grant_client_access(p_user_id uuid, p_project uuid, p_valid_until timestamptz) returns void`; redefined `claim_client_invite(p_token text) returns void` (now accepts a `client` caller).
- Consumes: `public.current_user_role()`, `public.client_portal_access`, `public.client_invites`, the LIVE `claim_client_invite` body.

- [ ] **Step 1: Claim the schema lane.** Append to `D:\claude\projects\prc-ops\LANES.md` a `🔨 SCHEMA LANE TAKEN — spec 234 U1` line with worktree + branch + reserved ts `20260813038000`; re-read to confirm it landed; confirm no other active `🔨` claim. (If the lane is held, STOP.)

- [ ] **Step 2: Source the live claim body.** Write `select pg_get_functiondef('public.claim_client_invite(text)'::regprocedure)` to a temp `.sql`, run `pnpm exec supabase db query --linked --file <f> -o json`, read the body. The redefinition in Step 5 must preserve everything except the gate + insert + audit changes below.

- [ ] **Step 3: Write the failing pgTAP test.** Create `supabase/tests/database/<n>_multi_project_client.sql` (standard `begin; select plan(N); … select * from finish(); rollback;`). Seed `auth.users` (PD, PM, two visitors v1/v2, one existing client `cli`), set roles, two projects A+B, and two `client_invites` (token for A, token for B — `token_hash = encode(extensions.digest('<cleartext>','sha256'),'hex')`). Grant `_tap_buf` to authenticated/anon (mirror `37-contractor-identity`). Assertions:
  - `grant_client_access` raises `42501` for a `project_manager` caller; succeeds for `project_director` (adds a `client_portal_access` row for `cli`+A).
  - `grant_client_access` raises `P0001` when the target user is NOT role `client` (pass a visitor's id).
  - `grant_client_access` raises `P0001` for an unknown project.
  - Re-grant un-revokes: seed a revoked `cli`+A row, call `grant_client_access(cli, A, future)` as PD, assert `revoked_at IS NULL` after.
  - `claim_client_invite` by an existing `client` (cli claims B's token) succeeds; assert a `cli`+B `client_portal_access` row exists, `users.role` is still `client` (no flip), and an audit row with `payload->>'event' = 'client_access_granted'` exists.
  - `claim_client_invite` by a `visitor` (v1 claims A's token) still flips role to `client` + writes a `role_change` audit (regression).
  - A `client` with live access to A and B sees BOTH projects: impersonate `cli` (granted A + claimed B), assert `select count(*) from public.projects` = 2.
  - `claim_client_invite` by a `site_admin` still raises `42501` (staff locked out).

- [ ] **Step 4: Run — expect FAIL.** Run: `pnpm db:test`. Expected: FAIL (`grant_client_access` does not exist; the re-entrant claim assertions fail against the old body).

- [ ] **Step 5: Write the migration.** Create `supabase/migrations/20260813038000_multi_project_client_access.sql`:

```sql
-- Spec 234 / ADR 0067 — multi-project client access. A NEW direct-grant RPC and
-- a re-entrant claim (visitor OR client). No table/RLS change — the access table
-- and the four read arms (mig 035000) are already per-project.

-- Direct grant: PD/super attach an EXISTING client login to a project. ON
-- CONFLICT un-revokes + refreshes the valid-until (resolves the spec-233
-- "revoke is terminal" limit).
create function public.grant_client_access(
  p_user_id uuid, p_project uuid, p_valid_until timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select public.current_user_role()) in ('project_director', 'super_admin'), false) then
    raise exception 'grant_client_access: role not permitted' using errcode = '42501';
  end if;
  if p_valid_until is null then
    raise exception 'grant_client_access: valid-until required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'grant_client_access: project not found' using errcode = 'P0001';
  end if;
  -- Only an EXISTING client login (a person who already claimed in via LINE).
  if not exists (select 1 from public.users where id = p_user_id and role = 'client') then
    raise exception 'grant_client_access: target is not a client' using errcode = 'P0001';
  end if;

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at)
  values (p_user_id, p_project, auth.uid(), p_valid_until)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null,
        revoked_by = null;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), (select public.current_user_role()), 'client_portal_access', p_project,
          jsonb_build_object('event', 'client_access_granted',
                             'user_id', p_user_id, 'project_id', p_project,
                             'access_expires_at', p_valid_until));
end;
$$;
revoke execute on function public.grant_client_access(uuid, uuid, timestamptz) from public, anon;
grant  execute on function public.grant_client_access(uuid, uuid, timestamptz) to authenticated;

-- Re-entrant claim: a visitor (first bind, flips role) OR an existing client
-- (additional project, no flip) may claim. Body is the LIVE claim_client_invite
-- (mig 036000) with the gate widened, the insert made ON CONFLICT DO UPDATE
-- (un-revoke), and the role-flip + audit branched on whether the caller was a
-- visitor. DROP+CREATE (signature unchanged).
drop function if exists public.claim_client_invite(text);
create function public.claim_client_invite(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invite      public.client_invites%rowtype;
  v_role        public.user_role;
  v_was_visitor boolean;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_client_invite: no user' using errcode = 'P0001';
  end if;
  if v_role not in ('visitor', 'client') then
    raise exception 'claim_client_invite: only a visitor or client may claim' using errcode = '42501';
  end if;
  v_was_visitor := (v_role = 'visitor');

  select * into v_invite from public.client_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception 'claim_client_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_client_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.created_at < now() - interval '14 days' then
    raise exception 'claim_client_invite: token expired' using errcode = 'P0001';
  end if;

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at)
  values (auth.uid(), v_invite.project_id, v_invite.created_by, v_invite.access_expires_at)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null,
        revoked_by = null;

  if v_was_visitor then
    update public.users set role = 'client' where id = auth.uid();
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('role_change', auth.uid(), 'client', 'users', auth.uid(),
            jsonb_build_object('from', 'visitor', 'to', 'client',
                               'project_id', v_invite.project_id, 'via', 'client_invite'));
  else
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('other', auth.uid(), 'client', 'client_portal_access', v_invite.project_id,
            jsonb_build_object('event', 'client_access_granted',
                               'project_id', v_invite.project_id, 'via', 'client_invite'));
  end if;

  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;
end;
$$;
revoke execute on function public.claim_client_invite(text) from public, anon;
grant  execute on function public.claim_client_invite(text) to authenticated;
```

- [ ] **Step 6: Push + regen types + run pgTAP.** Run: `pnpm db:push && pnpm db:types && pnpm db:test`. Expected: migration applies; the new test passes; the spec-233 `242-spec233-client-portal` pgTAP still passes (the relaxed claim is a superset — visitor path unchanged). Fix until green.

- [ ] **Step 7: Commit + ship (operator-held).**

```bash
git add supabase/migrations supabase/tests/database src/lib/db/database.types.ts worker/src/database.types.ts
git commit -m "feat: grant_client_access + re-entrant claim (spec 234 U1)"
```

Ship via `scripts/ship-pr.sh`; self-run `/caveman-review`; PAT-merge once real CI green (danger-path guard red by design).

---

## Task U2: `/client` multi-project render

**Files:** as listed under U2. Code-only; depends on U1 merged.

**Interfaces:**
- Produces: `loadClientView(supabase, projectId: string)` → `ClientView | null` (now project-scoped); `loadClientProjects(supabase)` → `ClientProjectSummary[]`; `<ClientProjectList>`; `ClientProgressView` gains optional `backHref`.
- Consumes: the per-project RLS read arms; `mintSignedUrls`; `requireRole(['client'])`.

- [ ] **Step 1: Write the failing reader test changes** in `tests/unit/load-client-view.test.ts`. Update the existing mock + calls so `loadClientView(supabase, "p1")` passes a projectId; add a case asserting the photo query is scoped to the project's work packages (seed two WPs, one in another project's id, assert only the target project's photos return) and that a non-matching project returns `null`. Keep the existing money-regex assertion over every `.select`.

- [ ] **Step 2: Write the failing `loadClientProjects` test** `tests/unit/load-client-projects.test.ts`: given a mocked RLS session returning two project rows, `loadClientProjects(supabase)` returns `[{id, code, name, status}, …]` with NO money column selected (money-regex over the `.select`); returns `[]` when none.

- [ ] **Step 3: Run — expect FAIL.** Run: `pnpm exec vitest run tests/unit/load-client-view.test.ts tests/unit/load-client-projects.test.ts`. Expected: FAIL (signature mismatch; `loadClientProjects` undefined).

- [ ] **Step 4: Add the project arg to `loadClientView`.** In `src/lib/client-portal/load-client-view.ts`, change the signature to `loadClientView(supabase: RlsClient, projectId: string)` and scope every read to `projectId`:
  - projects: `.select("id, code, name, status, site_address, start_date, planned_completion_date").eq("id", projectId).maybeSingle()` (RLS still gates; a non-live project returns null → the function returns null).
  - work_packages: `.eq("project_id", projectId)` (unchanged filter).
  - photo_logs: after computing `currentPhotos`, restrict to the project's WPs: build `const wpIds = new Set((wpRows ?? []).map((w) => w.id))` and filter `currentPhotos = currentPhotos.filter((p) => wpIds.has(p.work_package_id))` BEFORE minting URLs.
  - reports: add `.eq("project_id", projectId)`.

- [ ] **Step 5: Create `loadClientProjects`** in `src/lib/client-portal/load-client-projects.ts`:

```ts
import "server-only";

import type { createClient } from "@/lib/db/server";
import type { ProjectStatus } from "@/lib/db/enums";

type RlsClient = Awaited<ReturnType<typeof createClient>>;

export interface ClientProjectSummary {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
}

// The RLS "client reads own project" arm returns exactly the client's live
// projects. SAFE COLUMNS ONLY (no money).
export async function loadClientProjects(supabase: RlsClient): Promise<ClientProjectSummary[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, code, name, status")
    .order("code", { ascending: true });
  return (data ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status }));
}
```

- [ ] **Step 6: Run — expect PASS.** Run: `pnpm exec vitest run tests/unit/load-client-view.test.ts tests/unit/load-client-projects.test.ts`. Expected: PASS.

- [ ] **Step 7: Add `backHref` to `ClientProgressView`.** In `src/components/features/client-portal/client-progress-view.tsx`, add an optional prop `backHref?: string`; when present, render a back link (`←` to `backHref`) in the header before the project code/name. Keep the logout button.

- [ ] **Step 8: Create `<ClientProjectList>`** in `src/components/features/client-portal/client-project-list.tsx` — a Server Component listing the client's live projects (header with logout + a card per project linking to `/client/${id}`):

```tsx
import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import type { ClientProjectSummary } from "@/lib/client-portal/load-client-projects";

export function ClientProjectList({ projects }: { projects: ReadonlyArray<ClientProjectSummary> }) {
  return (
    <PageShell>
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink font-bold tracking-tight">ความคืบหน้าโครงการ</h1>
          <LogoutButton />
        </div>
      </header>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>โครงการของคุณ</h2>
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/client/${p.id}`} className={`${CARD} flex items-center justify-between gap-3`}>
                <span className="min-w-0">
                  <span className="text-ink-muted block font-mono text-xs">{p.code}</span>
                  <span className="text-ink block truncate text-sm font-medium">{p.name}</span>
                </span>
                <span className="text-ink-secondary shrink-0 text-xs">{PROJECT_STATUS_LABEL[p.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
```

- [ ] **Step 9: Rewrite `/client/page.tsx`** as the list/auto-open dispatcher:

```tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { loadClientProjects } from "@/lib/client-portal/load-client-projects";
import { loadClientView } from "@/lib/client-portal/load-client-view";
import { ClientProgressView } from "@/components/features/client-portal/client-progress-view";
import { ClientProjectList } from "@/components/features/client-portal/client-project-list";

export const metadata = { title: "ความคืบหน้าโครงการ" };

export default async function ClientPortalPage() {
  await requireRole(["client"]);
  const supabase = await createClient();
  const projects = await loadClientProjects(supabase);
  if (projects.length === 0) redirect("/client/access-ended");
  if (projects.length === 1) {
    const view = await loadClientView(supabase, projects[0]!.id);
    if (!view) redirect("/client/access-ended");
    return <ClientProgressView view={view} />;
  }
  return <ClientProjectList projects={projects} />;
}
```

- [ ] **Step 10: Create `/client/[projectId]/page.tsx`** drill:

```tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { loadClientView } from "@/lib/client-portal/load-client-view";
import { ClientProgressView } from "@/components/features/client-portal/client-progress-view";

export const metadata = { title: "ความคืบหน้าโครงการ" };

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ClientProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  await requireRole(["client"]);
  const supabase = await createClient();
  const view = await loadClientView(supabase, projectId);
  if (!view) redirect("/client"); // not a live project for this client (RLS returns nothing)
  return <ClientProgressView view={view} backHref="/client" />;
}
```

- [ ] **Step 11: Make `/client/claim` re-entrant.** In `src/app/client/claim/page.tsx`, change the already-bound redirect so a client WITH a token may still claim: replace `if (row?.role === "client") redirect("/client");` with `if (row?.role === "client" && !token) redirect("/client");` (a client with a token falls through to the claim card; a client with no token still bounces home).

- [ ] **Step 12: Register the routes in the nav anti-drift test.** In `tests/unit/nav-back-affordance.test.ts`, treat the whole external `/client` tree as bespoke (own header + logout, like `/portal`): filter the dynamic `client/[projectId]` page out of the DetailHeader requirement and add it to `EXCLUDED_ROUTES`. Change `const dynamicDetail = allPages.map(routeOf).filter(hasDynamicSegment);` to also exclude client routes: `const dynamicDetail = allPages.map(routeOf).filter((r) => hasDynamicSegment(r) && !r.startsWith("client/"));` and add `"client/[projectId]/page.tsx"` to `EXCLUDED_ROUTES` with a comment (spec 234: the external client portal is bespoke — own header + logout, no DetailHeader).

- [ ] **Step 13: Run + verify.** Run: `pnpm exec vitest run tests/unit/load-client-view.test.ts tests/unit/load-client-projects.test.ts tests/unit/nav-back-affordance.test.ts && pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.

- [ ] **Step 14: Commit.** `git commit -m "feat: /client multi-project list + drill (spec 234 U2)"`. Code-only → auto-merges on green.

---

## Task U3: PD direct-pick grant on the project page

**Files:** as listed under U3. Code-only; depends on U1's RPC live.

**Interfaces:**
- Consumes: `grant_client_access` RPC; `CLIENT_ISSUER_ROLES`; `requireActionRole`.
- Produces: `grantClientAccess({userId, projectId, validUntil})` action; `<ClientGrantExisting>`.

- [ ] **Step 1: Write the failing action test** in `tests/unit/client-portal-actions.test.ts` (extend): a `project_manager` caller is rejected by `grantClientAccess`; a `project_director` relays `{ p_user_id, p_project, p_valid_until }` to `grant_client_access` and returns `{ ok: true }`; a malformed `validUntil` is rejected before the RPC. Reuse the existing mock harness in that file.

- [ ] **Step 2: Run — expect FAIL** (`grantClientAccess` undefined).

- [ ] **Step 3: Implement the action** in `src/app/projects/[projectId]/actions.ts` (next to `createClientInvite`):

```ts
export async function grantClientAccess(input: {
  userId: string;
  projectId: string;
  validUntil: string;
}): Promise<ClientRevokeResult> {
  const gate = await requireActionRole(CLIENT_ISSUER_ROLES, CLIENT_ISSUER_ONLY_ERROR);
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isValidUuid(input.userId) || !isValidUuid(input.projectId)) {
    return { ok: false, error: CLIENT_INVITE_GENERIC };
  }
  if (!VALID_UNTIL_RE.test(input.validUntil)) return { ok: false, error: VALID_UNTIL_BAD };

  const { error } = await gate.auth.supabase.rpc("grant_client_access", {
    p_user_id: input.userId,
    p_project: input.projectId,
    p_valid_until: `${input.validUntil}T23:59:59+07:00`,
  });
  if (error) return { ok: false, error: CLIENT_INVITE_GENERIC };
  revalidatePath(projectHref(input.projectId));
  return { ok: true };
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `pnpm exec vitest run tests/unit/client-portal-actions.test.ts`.

- [ ] **Step 5: Write the failing component test** `tests/unit/client-grant-existing.test.tsx` (use `vi.hoisted` for the mocked action + toast, per the repo's hoisting rule): renders nothing-extra when `candidates` is empty (returns null); with candidates, picking a client + a date + clicking grant calls `grantClientAccess({ userId, projectId, validUntil })`; a success shows the success toast.

- [ ] **Step 6: Run — expect FAIL** (`ClientGrantExisting` undefined).

- [ ] **Step 7: Build `<ClientGrantExisting>`** in `src/components/features/client-portal/client-grant-existing.tsx` — a client component: a `<select>` of candidate client logins (by name) + a valid-until `<input type="date">` + a "ให้สิทธิ์" button → `grantClientAccess({ userId, projectId, validUntil })`; on success a success toast, on failure an inline error. Render nothing when `candidates.length === 0`. Mirror the structure of `client-invite-block.tsx` (FIELD class, BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT, useToast, useTransition).

- [ ] **Step 8: Run — expect PASS.** Run: `pnpm exec vitest run tests/unit/client-grant-existing.test.tsx`.

- [ ] **Step 9: Load candidates + render on the project page.** In `src/app/projects/[projectId]/page.tsx`, inside the existing `if (isClientIssuer)` admin block, after building `clientBindings`, also compute the candidate logins (existing clients NOT already on this project):

```ts
const onThisProject = new Set((accessRows ?? []).map((r) => r.user_id));
const { data: liveElsewhere } = await admin
  .from("client_portal_access")
  .select("user_id")
  .is("revoked_at", null)
  .neq("project_id", project.id);
const candidateIds = [...new Set((liveElsewhere ?? []).map((r) => r.user_id))].filter(
  (id) => !onThisProject.has(id),
);
const { data: candidateUsers } = candidateIds.length
  ? await admin.from("users").select("id, full_name").eq("role", "client").in("id", candidateIds)
  : { data: [] as { id: string; full_name: string | null }[] };
const clientCandidates = (candidateUsers ?? []).map((u) => ({
  id: u.id,
  name: u.full_name ?? "ลูกค้า",
}));
```

Then render `<ClientGrantExisting projectId={project.id} candidates={clientCandidates} />` right after `<ClientInviteBlock …/>` (still gated by `isClientIssuer`). Import it alongside `ClientInviteBlock`.

- [ ] **Step 10: Run + verify.** Run: `pnpm exec vitest run tests/unit/client-portal-actions.test.ts tests/unit/client-grant-existing.test.tsx && pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.

- [ ] **Step 11: Commit.** `git commit -m "feat: PD grant-existing-client picker (spec 234 U3)"`. Code-only → auto-merges on green.

---

## Self-Review

**Spec coverage:** §1 purpose → U1–U3. §2 D1 explicit grant → U1 `grant_client_access`. D2 two paths → U1 (re-entrant claim) + U3 (direct grant). D3 list→drill → U2. D4 gate → U1 gate + U3 `CLIENT_ISSUER_ROLES`. D5 un-revoke → U1 `ON CONFLICT DO UPDATE`. §3 no schema → confirmed. §4 RPCs → U1. §5 no new RLS → confirmed (reuses spec-233 arms). §6 routes → U2 + U3. §7 units → U1–U3. §8 out of scope → not built. §9 governance → Global Constraints. All mapped.

**Placeholder scan:** the `claim_client_invite` body in U1 Step 5 is shown in full but MUST be reconciled against the LIVE body sourced in Step 2 (the live body is the truth; the shown SQL is the spec-233 body with the four documented edits). `<n>` for the pgTAP filename is resolved at build (current max + 1). Everything else is concrete code/commands.

**Type consistency:** `loadClientView(supabase, projectId)`, `loadClientProjects`, `ClientProjectSummary`, `ClientProgressView backHref`, `grantClientAccess({userId, projectId, validUntil})`, `ClientRevokeResult`, `CLIENT_ISSUER_ROLES`, `VALID_UNTIL_RE`, `CLIENT_INVITE_GENERIC` — names consistent across tasks and with the spec-233 code they extend.

## Open risk

U1 is danger-path + schema lane (serialize behind any active schema session). The `claim_client_invite` redefinition changes an auth-adjacent role-flip path — source from LIVE, and the spec-233 `242` pgTAP must stay green (the relaxed gate is a strict superset of the visitor path). U2/U3 are code-only and auto-merge once U1 is live.
