# Spec 265 — Super-admin LINE-identity visibility

**Status:** DRAFT (2026-07-05). **No ADR** — this is **additive** to the identity
model and does **not** reverse or contradict any accepted decision; it **extends
ADR 0020** ("LINE profile picture as avatar / LINE owns the avatar, the user owns
`full_name`") by adding one more LINE-owned field on the *same* REFRESH-on-login
semantics. See § "Why no ADR" for the derivation. **Related:** ADR 0020 (avatar,
LINE-owned, refresh-on-login) · ADR 0017 (profile self-edit — `full_name` is
user-owned, NULL-only from LINE) · ADR 0012 (custom LINE auth callback — the file
this spec surgically edits) · ADR 0007 / 0019 (`public.users` schema + the
UPDATE-revoke that means writes go through the admin client) · spec 264 / ADR 0072
(staff self-onboarding — the approval surface this becomes the verification signal
for).

## Why this exists (the operator's requirement)

The operator wants **`super_admin` to ALWAYS see an employee's LINE ground-truth
identity** — the person's **LINE display name**, their **original LINE profile
image**, and a **"last checked" time** — *regardless* of what the person later
edited (their in-app `full_name`) or uploaded (their `profile_photo`). This is
**anti-impersonation / identity verification**: the LINE profile is data the person
does not control inside our app, so it is the trustworthy anchor.

It also becomes the **approval-time verification signal for staff self-onboarding**
(spec 264 / ADR 0072). When an approver opens `/registrations/[id]` to approve a
`visitor`'s self-registration, they can now confirm the applicant's **real LINE
identity** before assigning a role. **This is *why* the operator decided NOT to build
an on-site SA vouch** for staff onboarding — the LINE identity *is* the verification.

## Ground truth — the exact identity model today

Verified live against `main` on 2026-07-05 (callback
`src/app/auth/line/callback/route.ts`, migrations, `users` RLS).

**`public.users` columns relevant here:**

| Column | Source & write semantics today | Trust |
| --- | --- | --- |
| `full_name text` | Set from `claims.name` **NULL-only at first login** (`if (row.full_name === null && claims.name)`), then **user-editable** via ADR 0017's `update_my_display_name`. So it **DRIFTS** from the real LINE name once the person edits it. | user-owned — NOT ground truth |
| `line_avatar_url text` | **REFRESHED on every login** from `claims.picture` (`if (claims.picture !== row.line_avatar_url) …`). This IS the original LINE image — LINE-owned (ADR 0020). | LINE ground truth (already stored) |
| `line_user_id text` | NULL-only, immutable identity anchor. | LINE-owned |
| `updated_at timestamptz` | Bumps on **ANY** row change (the `users_set_updated_at` trigger) — **noisy**, not LINE-specific. | not usable as a "last LINE checked" time |

**The two gaps this spec closes:**

1. **There is NO field that always holds the current LINE display name.** `full_name`
   starts as the LINE name but is user-owned and drifts. To always show LINE
   ground-truth, a **separate** always-refreshed field is required.
2. **There is NO dedicated LINE-sync timestamp.** `updated_at` is bumped by any write,
   so it cannot answer "when did we last see this person's LINE profile?".

**Where the LINE identity is surfaced today:** `line_avatar_url` is read only in
**self-view** surfaces (`/profile`, `/coming-soon`, and as the e-card photo fallback
in `src/lib/register/card-view.ts`). It is **never** surfaced to an admin *about
another user*. So the anti-impersonation view does not exist yet.

**The approval surface** (spec 263/264): `/registrations/[id]/page.tsx` renders the
`staff_registrations` row (`full_name`, `phone`, docs, the uploaded `profile_photo`).
It does **NOT** join to `users`, so the applicant's LINE identity is not visible there
today — it must be fetched via `staff_registrations.user_id → users`. Gate =
`STAFF_APPROVAL_ROLES` (`procurement_manager | project_director | super_admin`).

**`users` RLS — load-bearing for the read mechanism (verified):** there are exactly
two SELECT-permitting policies —
- `users read self` — `auth.uid() = id` (own row only);
- `super_admin full access on users` — `current_user_role() = 'super_admin'` (all rows).

So on the **RLS session client**: a `super_admin` can read **any** user's row
(including the three LINE fields); a `procurement_manager` / `project_director` can
read **only their own** row — **not** the applicant's. This single fact drives both
the read-mechanism spec below and the gate recommendation. (`UPDATE` on `users` is
revoked from `authenticated`/`anon` — ADR 0019 — so all profile writes already go
through the admin/service-role client in the callback; this spec adds writes only to
that same block.)

## Locked decisions (operator — do not relitigate)

- **Two new `users` columns (both nullable):**
  - **`line_display_name text NULL`** — the **LINE-owned** display name, **refreshed
    EVERY login** from `claims.name`. This is **SEPARATE** from the user-editable
    `full_name`, so an admin always sees LINE ground-truth even after the person edits
    their in-app name. (Contrast: `full_name` = NULL-only + user-owned; `line_display_name`
    = always-refresh + LINE-owned. This is the crux of the whole spec — see the
    distinction box below.)
  - **`line_synced_at timestamptz NULL`** — the **"last checked time"**, stamped each
    login when the LINE profile is fetched. It is the **freshness** of the LINE identity
    data as of the person's last login.
- **"Last checked time" = last LINE login/sync.** The operator chose login-time sync
  over a periodic background re-check — there is **NO cron / worker / scheduled
  re-sync**. `line_synced_at` therefore answers "how fresh is this LINE snapshot?" =
  "when did they last log in?".
- **Callback change (surgical):** on **each** login, ALWAYS set
  `line_display_name = claims.name` (LINE-owned, always refresh — unlike `full_name`),
  `line_avatar_url = claims.picture` (already happens today — unchanged), and
  `line_synced_at = now()`. **`full_name` stays NULL-only / user-owned — UNCHANGED; the
  ADR-0020 invariant is not touched.**
- **Where `super_admin` sees it = BOTH surfaces:**
  1. an **identity block on the approval detail `/registrations/[id]`** showing
     `line_display_name` + the **original** `line_avatar_url` image + `line_synced_at`
     ("ตรวจล่าสุด …"), so identity is verifiable **at approval time**;
  2. a **per-employee detail surface** — reuse/extend the existing super_admin user
     surface (`/settings/roles`), not a new section (see § "The employee-detail home").
- **Gate:** the requirement says "super admin always" → the identity block is gated to
  `super_admin`. Whether the *other approvers* (`procurement_manager` / `project_director`)
  also see it at `/registrations/[id]` is an **open question** with a recommended default
  (see § Open questions O1).
- **Read mechanism:** `line_display_name` / `line_avatar_url` / `line_synced_at` are read
  **server-side behind the super_admin gate**. `line_avatar_url` is a **LINE-CDN URL**
  rendered in a **plain `<img>`** (external, `referrerPolicy="no-referrer"` per ADR 0020) —
  **no `next/image` remote-pattern config**. Read-client choice is spelled out per-surface
  in U2 (it hinges on the `users` RLS fact above).

### The distinction that must stay crystal clear

> **`full_name`** — what the person *calls themselves in our app*. Seeded from LINE
> once (NULL-only), then **user-owned and editable** (ADR 0017). It is allowed to
> drift. This is the label used everywhere in the product UI.
>
> **`line_display_name`** — what the person's *LINE account currently says*.
> **LINE-owned, refreshed every login**, never user-editable in our app. This is the
> **verification anchor**, shown only in the super_admin identity view. It is **not** a
> replacement for `full_name` and must **never** overwrite it.

## Unit plan

Two units, matching the house one-unit-per-session loop. **U1 → U2** (U2's views read
the columns U1 adds and call nothing U1 doesn't ship).

### U1 — schema + callback write (DANGER-PATH, operator-held)

**Held by the danger-path guard** — it adds a migration **and** edits
`src/app/auth/line/callback/route.ts` (the auth-outage-risk file). Expected held; do
not override.

- **Migration (additive, nullable):** add `line_display_name text` and
  `line_synced_at timestamptz` to `public.users`. Both **nullable, no default, no
  backfill** (see § backfill). No RLS policy change is required — the existing
  `users read self` + `super_admin full access on users` SELECT policies already cover
  every read this spec needs (self-view is unaffected; the super_admin view rides policy
  #2). No new column-level `GRANT` is needed for the **write** — the callback writes via
  the **admin (service-role) client**, which bypasses RLS (ADR 0007/0019, exactly like
  `line_avatar_url` today).
- **Callback write — SURGICAL, additive-only.** In `route.ts`:
  - Widen the step-6 users-row SELECT to also read `line_display_name`, `line_synced_at`
    (it already reads `full_name`, `line_avatar_url`) — needed only to compute a minimal
    diff / avoid a needless write; a plain unconditional set is also acceptable.
  - In the **existing step-7 profile-update block ONLY**, add to the `updates` object:
    - `line_display_name = claims.name` — **always** (LINE-owned refresh; unlike the
      NULL-only `full_name` line directly above it, which stays exactly as-is);
    - `line_synced_at = now()` (send an ISO timestamp / `new Date().toISOString()`);
    - `line_avatar_url` — **unchanged** (the existing refresh-on-login line stays).
  - **`full_name`'s NULL-only line is NOT touched.** The ADR-0020 / ADR-0017 ownership
    split is preserved verbatim.
  - ⚠️ **CONSTRAINT (auth-outage risk).** Touch **NOTHING** in the token exchange,
    `id_token` verify, session mint (`generateLink` → `verifyOtp`), CSRF/state
    validation, the handoff-flow branch, or the redirect. The **only** change is
    appending these writes to the object that is already being written in step 7. A
    write failure there is **already non-fatal** (the code logs and continues to the
    redirect) — keep that behavior; a LINE-profile write must never be able to block a
    login. Do not add a `line_synced_at` bump anywhere else (it must mean "LINE profile
    last fetched", not "row last touched").
  - **No audit row** for these fields — they are system-sourced (LINE), matching
    `line_avatar_url`'s no-audit treatment (ADR 0020 § "No audit row").
- **db:types** regen after the migration (`pnpm db:types`) so `line_display_name` /
  `line_synced_at` appear on the `users` Row type (worker types regen too — that touch is
  why the PR is held anyway).
- **pgTAP** — assert:
  - the two columns exist, are `NULL`-able, and are `text` / `timestamptz`;
  - the RLS posture is intact: `super_admin` may SELECT another user's row (the new
    columns included); a non-super_admin (e.g. `procurement_manager`) may SELECT **only**
    its own row — i.e. the columns did not accidentally open a new read path (this is a
    read-scope assertion on `users`, not a grant on the columns);
  - **no new `GRANT`/policy on `users`** widened write access (`UPDATE` stays revoked
    from `authenticated`/`anon` per ADR 0019).

  (pgTAP is warranted precisely because the claim "the columns need no new grant/RLS" is
  a security assertion that should be pinned, not assumed.)

- **NOT in U1:** any UI. No read surface changes. The columns simply start populating on
  each user's next login.

### U2 — views (code; likely held — imports the super_admin gate from `src/lib/auth`)

Two super_admin-gated, server-side-read views showing **LINE display name + original
avatar + last-synced**. Likely **held** because it imports a role constant / `requireRole`
from `src/lib/auth/**` (a protected path); if the final diff touches nothing under
`src/lib/auth`, it may auto-merge — the builder confirms at ship time, does not force.

- **A shared read helper + a shared presentational block.** Add a small server-only
  reader (e.g. `src/lib/identity/line-identity.ts`) — `getLineIdentity(userId)` →
  `{ lineDisplayName, lineAvatarUrl, lineSyncedAt }` — and one Server Component
  `LineIdentityBlock` (props: the three fields) rendering: the **original**
  `line_avatar_url` in a plain `<img referrerPolicy="no-referrer" loading="lazy">` (NOT
  `next/image`; reuse the ADR-0020 `AvatarSurface` pattern), the `line_display_name`, and
  `line_synced_at` formatted "ตรวจล่าสุด …" (via the existing `formatThaiDateTime`).
  When `line_synced_at` is `NULL` (never synced since the column shipped — see § backfill)
  the block shows a **"ยังไม่ได้ซิงค์"** ("not yet synced") state instead of empty fields.

- **Surface 1 — approval detail `/registrations/[id]`.** Render `LineIdentityBlock` for
  the applicant, resolved through `staff_registrations.user_id → users`. **Read
  mechanism:** because a `procurement_manager` / `project_director` cannot read another
  user's `users` row on their RLS session (see the RLS ground-truth), the read for this
  surface uses the **admin (service-role) client** scoped to the one `user_id` on the
  registration the caller already passed RLS to see — the **same exposure model as
  `admin-registrations.ts`'s signed-URL mint** (the row-level authorization the caller
  already has is the gate; the admin client only reads the identity of a user tied to a
  row they may see). **Visibility gate:** show the block to `super_admin` for certain;
  the proc_mgr/PD question is O1 (default recommended: **show to all three approvers** —
  they are the ones deciding, so verification-at-decision benefits them; the read is
  already admin-client-scoped to the one applicant, so no broad `users` exposure is
  created).

- **Surface 2 — per-employee detail (super_admin, off `/settings/roles`).** Add a
  per-user detail route **`/settings/roles/[id]`** (mirrors the existing
  `/settings/usage/[actorId]` per-user-detail precedent) gated `requireRole(['super_admin'])`,
  reached by making each row on the existing `/settings/roles` list link to it. Render
  `LineIdentityBlock` for that user beside their current role. **Read mechanism:** here a
  plain **RLS session client** read suffices — `super_admin full access on users` already
  permits reading any user's row, so no admin client is needed on this super_admin-only
  surface. (This is the leanest home — it reuses the existing super_admin role-admin
  surface and its gate rather than inventing a new section.)

- **Out of U2:** editing/refreshing LINE identity on demand (it refreshes on the user's
  own next login only); showing the block on non-super_admin product surfaces; any
  `next/image` remote-pattern config.

### Backfill decision (recommended: do NOT backfill)

A one-time backfill of `line_display_name` from `full_name` is **OPTIONAL and lossy** —
`full_name` may already be user-edited, so copying it would seed the *drifted* value into
the field whose entire purpose is to hold *un-drifted* LINE ground truth. **Recommend NOT
backfilling.** `line_display_name` / `line_synced_at` populate **naturally on each user's
next login**. **Documented gap:** until a given user logs in again after U1 ships, their
`line_display_name` / `line_synced_at` are `NULL` → the identity block renders
**"ยังไม่ได้ซิงค์"** for them. This is correct and honest (we genuinely have not
re-checked their LINE profile since the field existed) and self-heals on next login.

## The employee-detail home (chosen)

**Chosen: extend the existing `/settings/roles` super_admin surface with a per-user
detail route `/settings/roles/[id]`** — NOT a new section. Rationale: `/settings/roles`
is already the super_admin "every user + their role" screen (`requireRole(['super_admin'])`),
and the repo already has the per-user-detail pattern at `/settings/usage/[actorId]`. This
is the leanest home: reuse the existing gate + list as the entry point, add one detail
route, drop `LineIdentityBlock` on it. No new nav section, no new role gate.

## Read mechanism — summary (why it differs per surface)

| Surface | Gate | Read client | Why |
| --- | --- | --- | --- |
| `/settings/roles/[id]` | `super_admin` only | RLS **session** client | `super_admin full access on users` already permits reading any user's row. |
| `/registrations/[id]` block | `super_admin` (+ proc_mgr/PD per O1) | **admin (service-role)** client, scoped to the one `user_id` on the registration | proc_mgr/PD cannot read another user's `users` row on their RLS session; the admin read is scoped to a user tied to a row the caller already passed RLS to see (same model as the doc signed-URL mint in `admin-registrations.ts`). |

`line_avatar_url` in both is a LINE-CDN URL in a plain `<img referrerPolicy="no-referrer">`
(ADR 0020) — no `next/image`, no remote-pattern config, no image copy into Storage.

## Why no ADR

ADR 0020 already established the governing split: **LINE owns the profile image
(`line_avatar_url`, refresh-on-login); the user owns `full_name` (NULL-only from LINE,
user-editable per ADR 0017).** Spec 265 does not reverse, amend, or contradict that
split — it **applies the same LINE-owned / refresh-on-login rule to one more field**
(`line_display_name`) and adds a freshness timestamp (`line_synced_at`), while leaving
`full_name`'s user-owned semantics untouched. It introduces no new architectural axis, no
new security surface (self-view unchanged; the new admin read reuses the existing
service-role exposure model), and no destructive change. That is additive-within-an-
accepted-decision, so per the operator's guidance **no ADR is warranted** — this spec
plus the ADR-0020 citation is the SSOT. (Should a future unit add cross-user avatar
*proxying* or an on-demand re-sync worker, *that* would need its own ADR, as ADR 0020
already foreshadows for cross-user display.)

## Out of scope

- **Periodic background LINE re-sync** — the operator chose login-time sync; no cron /
  worker / scheduled re-check. "Last checked" = last login, by design.
- **Changing `full_name` semantics** — it stays user-owned + NULL-only from LINE. This
  spec never writes, reads-to-replace, or overwrites `full_name`.
- **The `/sa/registrations` retitle** — a separate tiny cleanup, not this spec.
- **Cross-user avatar display on product surfaces** (photo-log feeds, etc.) — still the
  deferred ADR-0020 concern; this spec exposes the avatar only in super_admin identity
  views.
- **On-demand "re-check LINE now" action / any LINE API call** — refresh happens on the
  user's own next login only.

## Open questions (for the operator)

- **O1 — approver visibility of the identity block at `/registrations/[id]`.** The
  requirement is "super_admin always". Should `procurement_manager` / `project_director`
  (the other approvers in `STAFF_APPROVAL_ROLES`) ALSO see the identity block at approval
  time? **Recommended default: YES — show it to all three approvers.** They are the ones
  making the approve/reject decision, so verification-at-decision is exactly for them; and
  the read is already admin-client-scoped to the single applicant `user_id`, so it creates
  no broad `users` exposure. The per-employee `/settings/roles/[id]` surface stays
  `super_admin`-only regardless. (If the operator prefers strict "super_admin only" on the
  approval surface too, U2 renders the block conditionally on `ctx.role === 'super_admin'`
  there — a one-line gate.)

## Verification checklist

- **U1** — `public.users` has `line_display_name text` (nullable) and `line_synced_at
  timestamptz` (nullable); `pnpm db:types` reflects both on the `users` Row type. A login
  sets `line_display_name = claims.name` and `line_synced_at = now()` on **every** login
  (not NULL-only), refreshes `line_avatar_url` as before, and leaves `full_name` written
  NULL-only exactly as before (an already-edited `full_name` is NOT overwritten). Token
  exchange / id_token verify / session mint / CSRF-state / handoff branch / redirect are
  byte-unchanged; a profile-write failure is still non-fatal (login still completes).
  pgTAP: columns exist + nullable + typed; `super_admin` can SELECT another user's row
  incl. the new columns; a non-super_admin can SELECT only its own row; no new
  grant/policy widened `users` write access.
- **U2** — `/settings/roles/[id]` (super_admin) shows the target user's LINE display name
  + original LINE avatar (plain `<img>`, no `next/image`) + "ตรวจล่าสุด …"; a user who has
  not logged in since U1 shows "ยังไม่ได้ซิงค์". The `/settings/roles` list links each row
  to its detail. `/registrations/[id]` shows the same identity block for the applicant
  (resolved via `user_id`), read through the admin client scoped to that one user, visible
  per O1's resolved gate; SA-read `/sa/registrations` is unchanged. `line_display_name`
  is shown as the **verification anchor** and never overwrites / is never confused with the
  product's `full_name` label. `pnpm lint && pnpm typecheck && pnpm test`. Real-browser:
  a super_admin opens a technician applicant's `/registrations/[id]`, sees the LINE name +
  original LINE photo + last-checked time next to the (possibly-different) submitted name/
  uploaded photo, and can confirm the identity before approving.
