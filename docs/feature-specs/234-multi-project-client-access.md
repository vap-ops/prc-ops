# 234 — Multi-project client access (extends ADR 0067)

**Status:** design approved (brainstorm 2026-06-30) → plan.
**Extends:** spec 233 / ADR 0067 (temporary client progress portal). No new ADR — the same `client` role and access model; this lifts the v1 one-project-per-client limit.

---

## 1. Purpose

A client login may hold live access to **more than one** project. A `project_director`/`super_admin` grants each project **explicitly** (two ways: pick an existing client directly, or re-send an invite link). `/client` lists the client's live projects and drills into each. Nothing internal (money, labor, costs, notes) is ever reachable — unchanged from spec 233.

This answers "how do I let a client see related projects": the director attaches the same client login to each project they should watch; the portal becomes a project list.

## 2. Locked decisions (brainstorm 2026-06-30)

| #   | Decision                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Mapping = explicit per-project grant** (one `client_portal_access` row per project). **NOT** auto-derived from `projects.client_id` — that would leak a customer's every project, including future ones. |
| D2  | **Two grant paths, both:** (a) **direct grant** — the PD picks an existing client and grants this project; (b) **re-send invite link** — an existing client taps a fresh per-project link.                  |
| D3  | **Render = project list → drill.** `/client` lists the live projects; tapping one opens its progress page. **One project → opens straight in** (spec-233 behaviour preserved).                            |
| D4  | **Grant/revoke gate = `project_director` + `super_admin` only** (`CLIENT_ISSUER_ROLES`) — unchanged from spec 233.                                                                                        |
| D5  | **Re-grant un-revokes.** `ON CONFLICT (user_id, project_id) DO UPDATE` clears `revoked_at` + refreshes the valid-until. This resolves the spec-233 "revoke is terminal per pair" limitation.              |

## 3. Data model

**No new tables, no column changes.** `public.client_portal_access` already allows N rows per client (`unique (user_id, project_id)`) and `client_has_live_access(p_project)` already evaluates per project. The four client read arms (`projects`, `work_packages`, `photo_logs`, `reports`) are already per-project — a client with N live access rows is already authorised for all N. Only the **grant path** and the **render** are single-project today.

## 4. RPCs (all `security definer`, revoke EXECUTE from `public`/`anon`, grant `authenticated`; null-safe role gate)

- **`grant_client_access(p_user_id uuid, p_project uuid, p_valid_until timestamptz) returns void`** — NEW. Gate `current_user_role() in ('project_director','super_admin')` (coalesce-false). Requires the **target user is already role `client`** (grant only to an existing client login — never an arbitrary user). Requires the project exists and `p_valid_until` not null. `INSERT INTO client_portal_access (user_id, project_id, granted_by, expires_at) VALUES (p_user_id, p_project, auth.uid(), p_valid_until) ON CONFLICT (user_id, project_id) DO UPDATE SET expires_at = excluded.expires_at, granted_by = excluded.granted_by, granted_at = now(), revoked_at = null, revoked_by = null`. Audit (`other`, `event = client_access_granted`).
- **`claim_client_invite(p_token text)` redefined** (DROP+CREATE, body sourced from LIVE first). The gate now admits role **`visitor` OR `client`** (else `42501` — staff/contractor still rejected, no silent flip). A `visitor` flips `users.role` to `client` as today; an existing `client` does **not** flip. The `client_portal_access` insert becomes `ON CONFLICT (user_id, project_id) DO UPDATE` (un-revoke + refresh the valid-until). Token hashing / single-use / 14-day link unchanged. Audit: `role_change` on the visitor→client flip (as today); `other`/`client_access_granted` when an existing client adds a project.
- `create_client_invite` / `revoke_client_access` — unchanged (spec 233).

## 5. RLS

**No new arms.** `client_has_live_access` + the four dedicated client read arms (spec 233 / migration `035000`) are already per-project. The `client_portal_access` manage arm (PD/super) + client-reads-own-row arm are unchanged. The grant/claim RPCs are the only writers (definer; direct DML stays blocked by the zero write-grant).

## 6. Routes / UI

- **`/client`** — `requireRole(['client'])`. Load the client's live projects (RLS-scoped). **0 → `/client/access-ended`; 1 → render that project's `ClientProgressView`** (unchanged); **≥2 → `ClientProjectList`** (a card per project: code · name · status → links to `/client/[projectId]`).
- **`/client/[projectId]`** — NEW. `requireRole(['client'])` + `loadClientView(supabase, projectId)`; `null` (not a live project for this client — RLS returns nothing) → redirect `/client`. Renders `ClientProgressView` + a back chip to `/client`.
- **`/client/claim`** — re-entrancy: a signed-in **client** with a token present may claim (don't bounce to `/client` until the claim runs); after a successful claim → `/client`. A client with **no** token → `/client` (as today). A visitor path is unchanged.
- **Project page (PD/super)** — beside the existing `ClientInviteBlock` (create a NEW client link), a **"grant an existing client"** control: a picker of clients the PD has granted elsewhere (excluding clients already on this project), each with a valid-until → `grantClientAccess` action → `grant_client_access`. Active client bindings + revoke (spec 233) unchanged.

## 7. Units (test-first)

- **U1 — schema.** `grant_client_access` RPC + the re-entrant `claim_client_invite` redefinition (sourced from LIVE) + pgTAP. Migration `20260813038000`. pgTAP: PD-only gate (pm → 42501), grant-to-non-client rejected, re-grant un-revokes, an existing client claims a 2nd project (no role change), a two-project client sees both projects via RLS, staff still locked out.
- **U2 — `/client` multi-project render.** `loadClientProjects` + `loadClientView(supabase, projectId)` (project arg) + `/client` list/auto-open + `/client/[projectId]` drill + claim-page re-entrancy + nav anti-drift registration. Vitest.
- **U3 — PD direct-pick grant UI.** `grantClientAccess` action + the existing-client picker on the project page (admin-read for names, exclude already-bound). Vitest.

## 8. Out of scope (YAGNI)

Auto-derive client↔projects from `projects.client_id`; client self-request access; cross-client project sharing; per-surface (photos-only / reports-only) scoping; client notifications; bulk grant. (List, don't build.)

## 9. Governance / risk

- **Danger-path:** U1 (migration + RPC redefinition incl. the role-flip path) is operator-held / PAT-merged; U2 + U3 are code-only → auto-merge on green.
- **Schema single-lane:** U1 touches `supabase/migrations/` — claim the lane in `LANES.md` first (migration ts = current-max + 1000 = `20260813038000`).
- **Source `claim_client_invite` from LIVE** (`pg_get_functiondef`) before redefining — never hand-invent (spec-233 / DB-migration-lessons law).
- **No money** in any client query (unchanged); `loadClientView(projectId)` keeps safe-columns-only.
- The `unique (user_id, project_id)` constraint **stays** — `ON CONFLICT DO UPDATE` makes re-grant work in place (no partial index needed).
- **PDPA:** the client still sees only the progress data it is entitled to, now across the explicitly-granted projects — no widening of the data exposed per project.
