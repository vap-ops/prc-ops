# Feature Spec 08: LINE profile picture as avatar (self-view MVP)

## Status

Locked — 2026-06-08. Backed by ADR 0020.
Read ADR 0020 in full before implementing — it carries the render rationale,
the REFRESH-on-login vs NULL-only decision, and the plain-`<img>` decision.

## Goal

Surface the authenticated user's LINE profile picture as an avatar on
`/profile` and `/coming-soon`. No scope change, no extra LINE API call —
the `picture` claim is already present in the `id_token` under the
existing `openid profile` scope.

## Locked decisions

1. **`picture` claim is already available.** Parse it from the `id_token`
   in `verifyLineIdToken`. No scope change, no extra API call.
2. **New column `public.users.line_avatar_url text` (nullable).** Stores
   the LINE CDN URL directly. Not copied into Storage (self-view MVP).
3. **REFRESH-on-login semantics.** Callback sets `line_avatar_url` to
   `claims.picture` whenever it differs from the stored value (including
   clearing to `null`). Contrast `full_name` / `line_user_id` (NULL-only).
4. **Render precedence: uploaded > LINE > initials.** `uploadedUrl` prop
   on `AvatarSurface` is the future uploader plug-in point; it is NOT
   populated in this unit.
5. **Plain `<img referrerPolicy="no-referrer" loading="lazy">`.** NOT
   `next/image`. Avoids remote-domain allowlisting and referrer leakage
   for the self-view case. Cross-user display is a future ADR.
6. **No audit row.** `line_avatar_url` is a system field (LINE owns it).
   Matches treatment of `line_user_id`.
7. **No RLS change.** Read already covered by `users read self`; write
   is admin-client only (callback).
8. **`database.types.ts` manually patched pre-merge.** `pnpm db:types`
   will supersede the patch after the delegated post-merge `db push`.

## Database

### Migration `20260608000000_add_line_avatar_url.sql`

```sql
alter table public.users add column line_avatar_url text;
```

Applied post-merge (delegated per `docs/policies/change-management.md`).
The `database.types.ts` patch in this PR allows typecheck to pass pre-apply.

## Application

### `src/lib/auth/verify-line-id-token.ts`

Add `picture: string | null` to `LineIdTokenClaims` and `picture?:
unknown` to `RawJwtPayload`. Parse: non-empty string → value; else `null`.
Same defensive style as `name`.

### `src/app/auth/line/callback/route.ts`

- Widen the users-row SELECT to include `line_avatar_url`.
- Widen the `updates` type to include `line_avatar_url?: string | null`.
- After the NULL-only `line_user_id` / `full_name` logic:
  ```ts
  if (claims.picture !== row.line_avatar_url) updates.line_avatar_url = claims.picture;
  ```

### `src/lib/profile/resolve-avatar.ts` (pure, unit-tested)

```ts
export type AvatarResult =
  | { kind: "uploaded"; url: string }
  | { kind: "line"; url: string }
  | { kind: "initials" };

export function resolveAvatar({
  uploadedUrl,
  lineUrl,
}: {
  uploadedUrl?: string | null;
  lineUrl?: string | null;
}): AvatarResult;

export function getInitials(fullName: string | null): string;
// Returns "" for null/empty/whitespace-only. Else first letter of each of
// the first two space-separated words, uppercased.
```

### `src/components/features/avatar-surface.tsx` (Server Component)

```ts
interface AvatarSurfaceProps {
  uploadedUrl?: string | null; // reserved for future uploader unit
  lineUrl?: string | null;
  fullName: string | null;
  size?: number; // px; default 64
}
```

- `uploaded` / `line`: `<img referrerPolicy="no-referrer" loading="lazy">`.
- `initials`: `<span>` with Tailwind, initials from `getInitials(fullName)`.
  Falls back to `"?"` if `getInitials` returns `""`.

### Mounting

- `src/app/profile/page.tsx`: add `line_avatar_url` to the SELECT; render
  `<AvatarSurface lineUrl={row.line_avatar_url} fullName={row.full_name} size={64} />`
  beside the page heading.
- `src/app/coming-soon/page.tsx`: add `line_avatar_url` to the SELECT;
  render `AvatarSurface` in both the unserved-role tile and the
  `OperatorHub` header. Pass through `lineAvatarUrl` and `fullName` to
  `OperatorHub` props.

## TDD plan (test first — state "Writing failing test first")

1. **`tests/unit/resolve-avatar.test.ts`** — precedence (uploaded wins;
   line when no upload; initials when neither); `getInitials` (single
   name, two names, three names, null/empty/whitespace, trims, uppercases).
2. **`tests/unit/verify-line-id-token.test.ts`** — `picture` parses to
   string when present; `null` when absent / null / non-string / empty
   string. Plus sub/name smoke tests.
3. **pgTAP `supabase/tests/database/16-users-line-avatar-url.test.sql`**
   — column exists; type is `text`; column is nullable. (3 assertions;
   new file rather than bumping `01-users.test.sql` plan count.)

## Verification checklist

- [ ] `pnpm lint` clean.
- [ ] `pnpm typecheck` clean (manual `database.types.ts` patch in scope).
- [ ] `pnpm test` — new unit tests pass; prior 103 still pass.
- [ ] `pnpm db:test` — 3 new pgTAP assertions pass (post-migration apply);
      prior passing assertions still pass.
- [ ] Post-merge (delegated): `supabase db push --linked`; `pnpm db:test`;
      confirm `information_schema.columns` shows `line_avatar_url` on
      `public.users`.
- [ ] Live: log in via LINE with a picture set → avatar renders on
      `/profile` and `/coming-soon`. User with no LINE picture → initials
      fallback. Change LINE picture, log in again → rendered avatar
      updates (proves REFRESH-on-login).

## Scope — out (record; do not build)

- User-uploaded avatar override: `avatar_url` column, `avatars` private
  bucket, own-folder storage RLS, `update_my_avatar_url` SECURITY
  DEFINER RPC, `AvatarUploader` client component. `AvatarSurface`'s
  `uploadedUrl` prop is the defined extension point. Revisit if real-world
  usage shows users without LINE pictures who want a custom one.
- Cross-user avatar display (different security surface — proxy /
  referrer / CSP policy needed).
- LINE `profile` scope change (already in scope; no action).

ADR 0018 and feature spec 06 remain reserved for the appsheet DB role unit.

## If blocked

When-blocked report + confidence %. Do not improvise the render mechanism
or the callback write semantic — both are locked by ADR 0020.
