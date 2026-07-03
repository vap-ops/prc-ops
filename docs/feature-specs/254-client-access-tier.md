# 254 — Client access tier (basic / full)

**Status:** approved via operator A/B (2026-07-03), building same session.
**Extends:** spec 233/234 (ADR 0067) client portal.

## 1. Purpose

Some clients should see more than others. A `project_director`/`super_admin`
can grant a client **basic** (current behaviour, unchanged) or **full** access
to a project. Full unlocks:

- **All-status photos.** Currently the portal shows approved photos only
  (the owning WP is `complete`). Full tier drops that status gate — every
  photo across every WP status (not_started/in_progress/on_hold/complete/
  pending_approval/rework) is visible. `phase = 'defect'` STAYS excluded for
  both tiers — spec 248's rule ("portal never reads defect photos") is
  independent of this spec and not touched.
- **Category + priority** on the WP-detail drill (spec unnumbered, shipped
  2026-07-03 as the previous session's unit): the WP's category name
  (resolved via `project_categories`) and priority, both currently omitted.

Nothing else changes. Money and notes stay unreachable for both tiers
(spec 233 D7 — untouched, not up for revision here).

## 2. Locked decisions (operator A/B, 2026-07-03)

| #   | Decision                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Full tier = all-status photos (defect phase still excluded) + WP category + priority.                                                                               |
| D2  | Tier is assignable **both** at invite time (PD picks basic/full when generating the link) **and** as an upgrade on an already-issued binding (no re-invite needed). |

## 3. Data model

### 3.1 New enum

```sql
create type public.client_access_tier as enum ('basic', 'full');
```

### 3.2 Column additions

- `client_portal_access.tier client_access_tier not null default 'basic'`
- `client_invites.tier client_access_tier not null default 'basic'` — carries
  the PD's choice through to the access row at claim time.

## 4. RPCs (all sourced fresh from LIVE, not the migration files — LIVE has

already drifted from the original spec-233 doc: `client_invites.token_hash`
not `token` (M1 hashing fix), and the photo RLS arm already excludes
`phase = 'defect'` (spec 248))

- `create_client_invite(p_project uuid, p_valid_until timestamptz, p_tier client_access_tier default 'basic')` —
  CREATE OR REPLACE (trailing optional param, no DROP needed), same gate,
  inserts `tier` into `client_invites`.
- `claim_client_invite(p_token text)` — CREATE OR REPLACE, propagates
  `v_invite.tier` onto the `client_portal_access` insert/on-conflict-update
  (both the fresh-grant and the re-entrant/un-revoke paths, spec 234 D5).
- `set_client_access_tier(p_access_id uuid, p_tier client_access_tier) returns void` —
  **new**, gate = PD/super (same as `revoke_client_access`), updates the
  `tier` column on an existing binding, audited (`event: client_access_tier_changed`).

## 5. RLS

- **`photo_logs`** — new additional permissive SELECT arm: same shape as
  "client reads approved project photos" but the `w.status = 'complete'`
  condition is replaced with `client_has_full_access(w.project_id)`, and
  `phase <> 'defect'` is KEPT. OR'd with the existing arm (a full-tier client
  matches either; a basic-tier client only ever matches the existing one).
- **`project_categories`** — new arm: `client_has_full_access(project_id)`.
  No arm exists for `client` today (only `can_see_project`, a staff-scoped
  helper) — this is a net-new grant, additive.
- **New helper** `client_has_full_access(p_project uuid) returns boolean` —
  mirrors `client_has_live_access` (same live-row shape) plus `tier = 'full'`.
  `SECURITY DEFINER`, revoke from `public`/`anon`, grant `authenticated`.

## 6. Application-layer gating (defense-in-depth, same pattern as the

existing "SAFE COLUMNS ONLY" comment)

`work_packages` RLS has no column restriction — `category_id`/`priority` are
already selectable by ANY client (basic or full) once the row is visible.
RLS is row-level, not column-level, so the tier gate for these two fields is
enforced in the **loader**: `loadClientWpDetail` calls
`client_has_full_access` (via `supabase.rpc`) and only includes
`categoryName`/`priority` in the returned view model when true. The category
NAME lookup itself is also naturally RLS-gated (a basic-tier client's
`project_categories` query returns 0 rows) — belt + suspenders.

The photo widening needs **no loader change** — RLS transparently returns
more rows once the new arm exists; the existing `loadClientView` /
`loadClientWpDetail` photo queries are unchanged.

## 7. UI

- **Invite block** (project settings page): a tier radio/select
  (พื้นฐาน/basic vs เต็มรูปแบบ/full) next to the valid-until date when
  generating a new invite link. `createClientInvite` action gains `tier`.
- **Active bindings list** (same block): each binding shows its tier + a
  control to change it via `set_client_access_tier` (new action
  `updateClientAccessTier`).
- **WP-detail drill** (`client-wp-detail-view.tsx`): renders category +
  priority rows only when present on the view model (their absence IS the
  basic-tier gate — no separate boolean prop needed).
- New label `WORK_PACKAGE_PRIORITY_LABEL` in `labels.ts` (doesn't exist yet;
  `work_package_priority` enum = `normal`/`urgent`/`critical`).

## 8. Out of scope (YAGNI)

Money/notes visibility (spec 233 D7 stays locked — a bigger security-model
conversation, not this spec). A third tier. Per-photo or per-WP granular
grants. Bulk tier assignment across bindings.

## 9. Governance

- **Danger-path:** migration + RLS ⇒ operator-held PR under the
  autonomous-build fence — but per the 2026-07-01 standing grant, CC
  self-reviews and PAT-self-merges its own additive-migration+code PRs on
  green CI (same pattern as the same-day GL-poster and finance-build PRs).
- **Schema single-lane:** claims `066000` (LIVE confirmed at `065000`
  immediately before the claim — see `LANES.md`).
- **PDPA:** no new PII exposure — full tier widens WHICH progress photos a
  client already entitled to that project can see, not WHO can see them.
