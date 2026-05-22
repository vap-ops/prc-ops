# ADR 0007: public.users is keyed to auth.users

Date: 2026-05-05
Status: Accepted
Amended by ADR 0010 (visitor default role, 2026-05-21).

## Context

V1 uses LINE Login via Supabase Auth. Site admins, PMs, and super admins all sign in through the same flow, and we need an application-level user record to attach role and profile data to.

## Decision

`public.users.id` is a `uuid` PRIMARY KEY that is also a FOREIGN KEY to `auth.users(id)` `ON DELETE CASCADE`. A trigger on `auth.users` INSERT auto-creates a matching `public.users` row with role defaulted to `'site_admin'`. Super admins promote new users via an `UPDATE` on `public.users.role`.

## Consequences

- Tightly coupled to Supabase Auth; migrating off Supabase requires reworking auth. Acceptable for v1.
- Every authenticated identity has exactly one application-level user row, simplifying RLS policies that join against `public.users`.
- Role changes are pure data operations on `public.users`, with no parallel state in `auth.users` to keep in sync.
