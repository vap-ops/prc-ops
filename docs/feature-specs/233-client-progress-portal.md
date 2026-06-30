# 233 — Client progress portal (temporary, scoped, read-only)

**Status:** design approved (brainstorm 2026-06-30), spec pending operator review → plan.
**Requires:** new ADR **0067** (adds `client` to `public.user_role`).
**Pattern parent:** spec 130 / ADR 0051 (DC self-service portal — claim-token + scoped-RLS external login). This spec mirrors that machinery for a _customer_ audience, kept fully separate.

---

## 1. Purpose

A **project_director** issues a temporary, read-only login so a project's **client/customer** can watch progress — project summary, work-package status, approved progress photos, and progress-report PDFs — for **one** project. Access carries a **valid-until date** and can be **revoked early**. Nothing internal (money, labor, costs, notes) is ever reachable.

This is the literal answer to "create a new user, like the clients' portal, but temporary": the director creates the account by issuing a claim link; the client binds it via LINE login; it lapses on the date or on revoke.

## 2. Locked decisions (from brainstorm)

| #   | Decision                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **New role** `client` on `public.user_role` (ADR 0067). Distinct from `visitor`/`contractor`. The CRM `clients` table is unrelated (customer records, not logins) — do not conflate.        |
| D2  | **Auth = LINE**, reusing the spec-130 claim flow. No email/password (not wired).                                                                                                            |
| D3  | **Access mode = real per-person account**, not a no-login link.                                                                                                                             |
| D4  | **Temporary = `expires_at` (valid-until) + manual early revoke.**                                                                                                                           |
| D5  | **Scope = one project**, read-only: project summary · WP status · approved progress photos · report PDFs.                                                                                   |
| D6  | **Issuer/revoker = `project_director` + `super_admin` only. NOT `project_manager`.**                                                                                                        |
| D7  | **Dedicated read paths.** The client view gets its own queries + own RLS arms. No existing staff/PM query is widened. No money columns selected anywhere, column-grant-blocked as backstop. |

## 3. Data model

### 3.1 Enum (own migration — `ALTER TYPE … ADD VALUE` cannot share a txn; see ADR 0008 precedent)

```
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'client';
```

### 3.2 `public.client_portal_access` — the binding + temporary state

| column       | type                                  | note                                                              |
| ------------ | ------------------------------------- | ----------------------------------------------------------------- |
| `id`         | uuid pk                               |                                                                   |
| `user_id`    | uuid → users(id)                      | the client login                                                  |
| `project_id` | uuid → projects(id) on delete cascade | the one project                                                   |
| `granted_by` | uuid → users(id)                      | the PD/super who issued                                           |
| `granted_at` | timestamptz default now()             |                                                                   |
| `expires_at` | timestamptz                           | the valid-until (UI requires it; column nullable for flexibility) |
| `revoked_at` | timestamptz null                      | set on early revoke                                               |
| `revoked_by` | uuid → users(id) null                 |                                                                   |
| unique       | (`user_id`,`project_id`)              | one binding per pair                                              |

**Live access** ≔ row exists `AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
Helper: `public.client_has_live_access(p_project uuid) returns boolean` — `EXISTS` of a live row for `auth.uid()` + `p_project`. Used by every client read policy and the page gate.

### 3.3 `public.client_invites` — the single-use claim token (mirror of `contractor_invites`)

| column                      | type                      | note                                                  |
| --------------------------- | ------------------------- | ----------------------------------------------------- |
| `id`                        | uuid pk                   |                                                       |
| `token`                     | text unique               | random, single-use                                    |
| `project_id`                | uuid → projects(id)       |                                                       |
| `access_expires_at`         | timestamptz               | the valid-until to stamp onto the access row at claim |
| `created_by`                | uuid → users(id)          | the PD/super                                          |
| `created_at`                | timestamptz default now() |                                                       |
| `claimed_at` / `claimed_by` | timestamptz / uuid null   | set on claim                                          |

**Two clocks:** the invite link dies after **14 days or one use**; the _access_ lives until `access_expires_at`. Separate concerns.

## 4. RPCs (all `security definer`, revoke EXECUTE from `public`/`anon`, grant `authenticated`; null-safe role gate)

- `create_client_invite(p_project uuid, p_valid_until timestamptz) returns text` — gate `current_user_role() in ('project_director','super_admin')`; inserts `client_invites`, returns the token. Audited.
- `claim_client_invite(p_token text) returns void` — the **only** sanctioned `visitor → client` writer, RLS-scoped session (never admin client). Requires caller role = `visitor` (a staff/contractor LINE identity is rejected — no silent role flip). Validates token live (exists, unclaimed, ≤14 days). Sets role `client`, inserts `client_portal_access` (project + `access_expires_at`, `granted_by` = invite creator), marks token claimed. Audited.
- `revoke_client_access(p_access_id uuid) returns void` — gate PD/super; stamps `revoked_at`/`revoked_by`. Audited.

## 5. RLS

- `client_portal_access` / `client_invites`: RLS on, `revoke all from anon, authenticated`, explicit grants. Manage arms (insert/select/delete) gated to `project_director`/`super_admin`; the client reads only its own `client_portal_access` row.
- **Client read arms (new, dedicated):** on `projects`, `work_packages`, `photo_logs` (approved only), and the reports surface — each adds an arm `TO authenticated` whose `USING` requires `current_user_role() = 'client'` AND `client_has_live_access(<the row's owning project>)`, eval-once wrapped `(select …)`. The owning project is resolved per table — directly where a `project_id` exists, otherwise via the row's work package (`photo_logs` → `work_packages.project_id`) or report params. These are _additional_ policies, never edits to staff arms. Implementation must confirm each table's actual project linkage before writing the arm.
- Storage (photos bucket, report PDFs): client fetches via **signed URLs through the RLS server client**; approved + watermarked only.

## 6. Routes / UI

- `roleHome()` gains `client → /client`. Every other non-live state falls through to the access-ended page.
- **`/client`** — `requireRole(['client'])` + live-access check. Renders the four read-only surfaces scoped to the single live project. No money, no notes, no edit controls. Logout button.
- **`/client/claim?token=…`** — reachable by a signed-in visitor (not `requireRole(['client'])`, or a fresh signup bounces). Confirm button → `claim_client_invite`. An already-bound live client → redirect `/client`.
- **Access-ended page** — calm "การเข้าถึงสิ้นสุดแล้ว — ติดต่อผู้อำนวยการโครงการ" notice. Where an expired/revoked client lands (not an error, not `/coming-soon`).
- **Invite block on the project page** (PD/super only): pick valid-until date → generate link (`buildClientClaimUrl`) → copy/send; list active client bindings + a revoke button.

## 7. Units (test-first; each its own session per repo workflow)

- **U1 — ADR 0067 + enum + routing skeleton.** Author ADR 0067; enum migration (own file); `roleHome` `client → /client`; access-ended page; `/client` + `/client/claim` stubs gated. Tests: roleHome routing, gate redirects.
- **U2 — schema + RPCs + RLS.** `client_portal_access`, `client_invites`, `client_has_live_access`, the 3 RPCs, manage + client read RLS arms. pgTAP: live/expired/revoked visibility, anon/visitor lockout, money-column non-exposure, PD-only issue/revoke, visitor-only claim.
- **U3 — PD invite UI.** Project-page invite block: date pick → create → show link → list/revoke. Vitest + action tests.
- **U4 — `/client` render.** Dedicated readers for the four surfaces, signed-URL photo/report fetch, read-only. Vitest + e2e smoke.
- **U5 — `/client/claim` flow.** Claim page + action relay + already-bound redirect. Tests for invalid/expired/used token, non-visitor rejection.

## 8. Out of scope (YAGNI)

Multi-project client accounts (table allows N rows; UI binds one). Client-side comments/approvals. Email/password auth. Notifications to the client. Self-serve renewal. Branding/white-label. (List, don't build — surface as follow-up specs if wanted.)

## 9. Governance / risk

- **Danger-path:** migrations + `src/lib/auth/**` + RLS + new role ⇒ every PR is operator-held under the autonomous-build fence; not auto-merge.
- **Schema single-lane:** U2 touches `supabase/migrations/` — needs the one shared schema lane, currently held by the ADR0066 chain. Serialize; claim the lane in `LANES.md` with a migration timestamp before starting.
- **ADR 0067** must land (or co-land) with U1.
- **DB lessons:** enum-add in its own migration; definer RPCs revoke from `public`/`anon`; pgTAP `plan(N)` + 42501 + anti-join patterns; source any later RPC redefinition from LIVE.
- **PDPA:** client is an external data subject; the portal exposes only progress data they're entitled to — no worker PII, no money.

## 10. Resolved (operator, 2026-06-30 — defaults accepted)

1. Issue/revoke gate = `project_director` **+ `super_admin`** (super retained).
2. **Any** `project_director` may issue a client link for **any** project (PDs see-all per ADR 0058); `super_admin` too.
3. Reports PDF — **all** generated reports are shareable (no "share with client" subset in v1).
