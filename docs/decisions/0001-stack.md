# ADR 0001: Technology Stack

Date: 2026-05-03  
Status: Accepted

## Context

We need a web platform for PRC site admins (PWA) and project managers (PM web). Both audiences require real-time data, photo management, and approval workflows.

## Decision

### Frontend

- **Next.js 16.x App Router** as a single application serving both audiences via different route segments.
  - Site admins use the PWA-optimised routes (installable, offline-capable).
  - PMs use standard web routes within the same app.

> Updated 2026-05-04: stack moved to Next.js 16.x during initial scaffold. cookies() from next/headers is async-only in 16, which matches the contract @supabase/ssr expects for the App Router. No other API changes are relevant to the v1 scope.

### Backend / Infrastructure

- **Supabase** provides:
  - **Postgres** as the primary database with Row Level Security on every table.
  - **Supabase Auth** for user management and session handling.
  - **Supabase Storage** for photo originals and generated reports.
  - **RLS policies** enforce tenant isolation and role-based access at the database layer.

### Authentication

- **LINE OAuth via Supabase Auth** (PWA / browser-based OAuth, not LIFF) for v1 site admin and PM login.
- LIFF (LINE Front-end Framework) is deferred to v2 for the technician Mini App.

### Admin Tooling

- **AppSheet** remains untouched for the admin team in v1. No migration or integration is planned.

## Consequences

- A single Next.js codebase reduces maintenance overhead but requires disciplined route and component organisation.
- Supabase Auth with LINE OAuth means we depend on LINE's OAuth endpoints; degraded LINE service will block login.
- AppSheet staying in place means dual data entry risk for the transition period — accepted for v1.
