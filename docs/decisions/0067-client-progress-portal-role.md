# ADR 0067 — `client` role for a temporary, scoped, read-only progress portal

**Status:** Accepted (2026-06-30)
**Extends:** 0051 (external partner access model), 0013 (project access model), 0058 (`project_director`), 0008 (role-enum expansion)
**Spec:** `docs/feature-specs/233-client-progress-portal.md`

## Context

A `project_director` needs to give a project's **client/customer** a temporary
window onto progress — project summary, work-package status, approved progress
photos, and progress-report PDFs — for **one** project, with a valid-until date
and the ability to revoke early. Nothing internal (money, labor, costs, notes)
may ever be reachable.

This is the same shape ADR 0051 already solved for direct contractors: an
external person logs in via LINE, claims a single-use invite token, and lands
on a hard-bounded, RLS-scoped portal. The client audience differs from the
contractor audience (read-only, customer-facing, time-boxed) and from the CRM
`clients` table (which holds customer _records_, not _logins_ — not to be
conflated).

## Decision

1. **Add `client` to `public.user_role`** (its own migration —
   `ALTER TYPE ... ADD VALUE` cannot share a transaction; ADR 0008 precedent).
   It is distinct from `visitor` (the pre-promotion default) and `contractor`
   (the DC portal audience).

2. **Reuse the ADR-0051 claim machinery**: a single-use, 14-day,
   token-**hashed** invite (`client_invites`, mirroring `contractor_invites`
   per migration `20260813024000`) bound on claim to a `client_portal_access`
   row (one client user → one project) carrying `expires_at` + `revoked_at`.
   **Two clocks:** the invite link dies after 14 days or one use; the _access_
   lives until its valid-until date or an early revoke. **Live access** ≔ a row
   exists with `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.

3. **Issuer/revoker = `project_director` + `super_admin` only** — a new
   `CLIENT_ISSUER_ROLES` set, deliberately **not** `PM_ROLES` (which also
   contains `project_manager`). A client login is customer-facing; the PM does
   not grant it. Per ADR 0058, any `project_director` sees all projects, so any
   PD may issue for any project.

4. **Dedicated read paths.** The `client` view gets its **own** queries and its
   **own** additive RLS arms on `projects`, `work_packages`, `photo_logs`
   (approved only) and the reports surface — each gated on
   `current_user_role() = 'client' AND client_has_live_access(<owning project>)`.
   No existing staff/PM policy is widened. **No money columns** are selected in
   any client query; column grants are the backstop. Photos and report PDFs are
   served as watermarked signed URLs through the RLS server client.

5. **Routing.** `roleHome('client') → /client`. An expired/revoked client keeps
   role `client`; the `/client` gate forwards it to `/client/access-ended` (a
   calm lapsed-access notice, never an error or `/coming-soon`). The only
   sanctioned `visitor → client` writer is the `claim_client_invite` RPC, which
   rejects any non-`visitor` caller (no silent role flip).

## Consequences

- One more enum value (irreversible-ish; removal needs an ADR). Acceptable —
  `client` is a first-class external audience, not a transient flag.
- The portal is **PDPA-relevant**: the client is an external data subject and
  sees only the progress data they are entitled to — no worker PII, no money.
- Every migration / `src/lib/auth/**` / RLS / new-role change here is
  **danger-path** under the autonomous-build fence (operator-held or PAT-merged
  after self-review), never silent auto-merge.
- Out of scope (YAGNI, surface as follow-up specs if wanted): multi-project
  client accounts, client-side comments/approvals, email/password auth, client
  notifications, self-serve renewal, white-label branding.
