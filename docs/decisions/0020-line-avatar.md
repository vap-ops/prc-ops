# ADR 0020: LINE profile picture as avatar (self-view MVP)

## Status

Accepted — 2026-06-08

Amends ADR 0007 (`public.users` keyed to `auth.users`). ADR 0007 remains
the foundational record for the `auth.users → public.users` linkage, the
auto-create trigger, and the role-based access concept. This ADR adds the
first LINE-sourced image field to the user profile and defines how it is
rendered.

## Context

Users' LINE accounts carry a profile picture (`picture` claim in the
HS256 `id_token`). The `openid profile` scope — already authorised, no
scope change required — includes this claim. v1 ignored it; the user
profile page shows only a display name with no visual identity cue.

This ADR introduces a self-view avatar for the profile and
`/coming-soon` pages using the LINE-sourced URL directly. It explicitly
defers the user-uploaded avatar mechanism (own `avatars` bucket, storage
RLS, `update_my_avatar_url` SECURITY DEFINER RPC) to a future unit.

### Why store the URL, not the image

Copying LINE CDN images into Supabase Storage would require a background
worker, doubles storage cost for an MVP feature, and complicates
revocation when a user updates or removes their LINE picture. Storing the
URL and fetching it at render time avoids all of that for the self-view
case (the only consumer in this unit).

Cross-user display — e.g., a photo-log feed showing the submitter's
avatar — is a future concern. That context needs tighter guarantees
(image proxying to avoid leaking referrers to other users' browsers,
Content Security Policy implications). This ADR explicitly out-of-scopes
it and defers the policy to the unit that ships cross-user display.

### REFRESH-on-login vs NULL-only

`full_name` and `line_user_id` use NULL-only semantics: set once at first
login, never overwritten by the callback. `full_name` is user-correctable
via `update_my_display_name` (ADR 0017); `line_user_id` is an immutable
identity anchor.

`line_avatar_url` is deliberately different: the callback sets it to
`claims.picture` whenever it differs from the stored value (including
clearing to `null` if the user removed their LINE profile picture). The
rationale:

- LINE **owns** this field. The URL is not user-authored; it reflects the
  current state of the user's LINE account. Refreshing it on login is the
  correct semantic.
- `full_name` is user-authored (correctable via ADR 0017's RPC). Keeping
  the user's manual edits rather than overwriting them from LINE is the
  correct semantic for that field.
- No audit row is written for `line_avatar_url` changes. It is a
  system-sourced field (like `line_user_id`), not a user action.

## Decision

### Schema

Single migration `20260608000000_add_line_avatar_url.sql`:

```sql
alter table public.users add column line_avatar_url text;
```

Nullable, no default. No RLS policy change needed: the existing `users
read self` policy already permits a user to SELECT their own row. No
column-level grant needed: the callback write uses the admin
(service-role) client (ADR 0007's write path), which bypasses RLS.

### Callback (src/app/auth/line/callback/route.ts)

1. `verifyLineIdToken` now returns `picture: string | null` alongside
   `sub` and `name`.
2. The users-row SELECT is widened to include `line_avatar_url`.
3. In the profile-write block, after the NULL-only `line_user_id` /
   `full_name` logic, add:
   ```ts
   if (claims.picture !== row.line_avatar_url) updates.line_avatar_url = claims.picture;
   ```
   This handles three cases: initial set (stored is `null`, claims has a
   URL), refresh (URL changed on LINE), and clear (user removed their
   LINE picture — `claims.picture` is `null`, stored is a URL).

### Render

Render precedence: **uploaded > LINE > initials**. The uploaded slot is
reserved for the future uploader unit; `AvatarSurface.uploadedUrl` is the
plug-in point.

**`src/lib/profile/resolve-avatar.ts`** (pure, unit-tested):

- `resolveAvatar({ uploadedUrl?, lineUrl? })` → `{ kind: "uploaded"|"line"|"initials", url? }`
- `getInitials(fullName: string | null)` → `""` for null/empty; first
  letter of the first two space-separated words, uppercased.

**`src/components/features/avatar-surface.tsx`** (Server Component):

Props: `{ uploadedUrl?, lineUrl?, fullName, size? }`.

- For `uploaded` / `line`: a plain `<img referrerPolicy="no-referrer"
loading="lazy">` — **not** `next/image`. Reasons:
  - `next/image` requires every external domain to be listed in
    `next.config` `remotePatterns`. LINE CDN URLs span multiple
    subdomains; keeping that list accurate is maintenance burden for a
    self-view image.
  - `referrerPolicy="no-referrer"` prevents the user's session URL from
    leaking to LINE's CDN in the `Referer` header. `next/image` proxied
    mode would solve this too, but adds a server round-trip and
    complexity not warranted for a self-view MVP.
  - For cross-user display (future ADR), proxy mode becomes appropriate;
    that decision is deferred.
- For `initials`: an inline `<span>` with Tailwind styling — no network
  request.

Rendered on:

- `/profile` — beside the page heading.
- `/coming-soon` — for both the unserved-role tile and the
  `super_admin` `OperatorHub`.

## Scope

**In scope (this ADR):**

- `public.users.line_avatar_url text` (nullable).
- `picture` parsing in `verifyLineIdToken`.
- REFRESH-on-login write in the callback.
- `resolveAvatar` + `getInitials` pure helpers.
- `AvatarSurface` component.
- Avatar render on `/profile` and `/coming-soon`.

**Explicitly out of scope (deferred to a future unit):**

- User-uploaded avatar override: `avatar_url` column, `avatars` private
  Storage bucket, own-folder storage RLS, `update_my_avatar_url`
  SECURITY DEFINER RPC, `AvatarUploader` client component.
- Cross-user avatar display (different security surface — referrer and
  CSP policy needed before exposing LINE CDN URLs in other users'
  browsers).
- LINE `profile` scope change (already authorised; no action needed).

ADR 0018 and feature spec 06 remain **reserved** for the gated appsheet
DB role unit. They are not claimed by this ADR.

## No audit row

`line_avatar_url` is a system-owned field (LINE is the source of truth).
No `audit_log` row is written for changes. This matches the treatment of
`line_user_id`. Contrast `full_name` (ADR 0017), which writes
`action='profile_update'` because the user is the author of that change.

## Consequences

**Positive**

- Users see their LINE profile picture on `/profile` and `/coming-soon`
  immediately after login, with no additional scope or LINE API call.
- Picture stays current across sessions (REFRESH-on-login).
- `AvatarSurface.uploadedUrl` prop is the defined extension point; the
  uploader unit slots in without changing the component API.
- No new RLS policy and no `GRANT` on `public.users` (write is
  admin-client only; read is already covered).

**Negative**

- LINE CDN image URLs can expire or change without notice. The stored URL
  may become stale between logins. Acceptable for an MVP self-view feature
  — each login refreshes it.
- Plain `<img>` cannot leverage Next.js image optimisation. Acceptable:
  LINE profile pictures are typically small (< 10 KB).

**Neutral**

- `database.types.ts` is manually patched in this unit to add
  `line_avatar_url` to the `users` Row/Insert/Update types. The patch
  will be superseded by `pnpm db:types` after the migration is applied
  post-merge.

## References

- ADR 0007 — Users and Auth (amended by this ADR)
- ADR 0012 — Custom LINE auth flow (the callback this ADR modifies)
- ADR 0017 — Profile self-edit (contrast NULL-only vs REFRESH-on-login
  semantics; defines `full_name` ownership)
- [`docs/feature-specs/08-profile-image.md`](../feature-specs/08-profile-image.md) — the locked spec
- `supabase/migrations/20260608000000_add_line_avatar_url.sql`
