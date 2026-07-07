# Spec 274 — super_admin "View as role"

**Status:** 🚧 **BUILD — U1 (backend core) complete 2026-07-07; U2 (UI) not started.**
**ADR:** [0077-superadmin-view-as-role.md](../decisions/0077-superadmin-view-as-role.md)
**Origin:** operator directive 2026-07-07 — "superadmin must be able to access every role's view."
Clarified: **view-as-role** (keep own identity + RLS, not user-impersonation) · **fully active** (the
assumed role gates actions too) · entry from Settings admin, exit from a persistent banner.

## 1. Problem

super_admin cannot experience another role's view. It lands on `/dashboard` with the PM nav; single-role
pages (`/technician`, `/portal`, `/client`) gate an exact role and redirect super_admin away; there is no
way to see any role's tailored home + nav + page-set. Needed for support, QA, and verifying what each
role sees.

## 2. Decisions (operator-confirmed 2026-07-07)

| #   | Decision                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **View-as-role, not impersonate-a-user.** super*admin keeps its own `auth.uid` + RLS; only the \_role* is re-interpreted.                                                                                                                                                           |
| D2  | **Single TS-layer resolver is the SSOT.** `resolveEffectiveRole(realRole, cookie)` — assumed role IFF real role is super_admin AND cookie ∈ `ASSUMABLE_ROLES`; else real role. Wired into `loadUserContext` + `requireActionRole`. (ADR 0077 D1.)                                   |
| D3  | **Forge-guard = the security boundary.** Override applies only when the REAL role is super_admin, re-checked every request. A non-super's forged cookie is inert. (ADR 0077 D2.)                                                                                                    |
| D4  | **DB fidelity is impossible by design — accepted.** Postgres always sees super_admin (`current_user_role()` on `auth.uid()`). No new privilege; "fully active" is faithful at the TS gate, writes execute as super_admin underneath. Assumed-role audit is TS-layer. (ADR 0077 D3.) |
| D5  | **Fully active.** The assumed role gates actions via `requireActionRole`, so a narrower assumed role loses access at the TS gate.                                                                                                                                                   |
| D6  | **Assumable = served roles with a UI.** Excludes super_admin + the `/coming-soon` roles. Identity-scoped roles (technician/contractor/client) render a "no personal data in this view" placeholder. (ADR 0077 D4.)                                                                  |
| D7  | **Enter from Settings admin; exit from a global banner; `/settings` + logout stay on the real role.** Enter/exit actions resolve the REAL role so exit always works; logout clears the cookie. (ADR 0077 D2/D5.)                                                                    |
| D8  | **Deferred:** write-fidelity for the ~30 inline `users.role` reads (they keep super_admin authority — a fidelity gap, never an escalation); user-impersonation; a request-scoped GUC for DB fidelity.                                                                               |

## 3. Mechanism

- **`src/lib/auth/effective-role.ts`** (pure, importable anywhere): `ASSUMED_ROLE_COOKIE`,
  `ASSUMABLE_ROLES` (`site_admin, project_manager, project_director, project_coordinator, procurement,
procurement_manager, accounting, technician, contractor, client`), `isAssumableRole`,
  `resolveEffectiveRole`.
- **`src/lib/auth/assumed-role.server.ts`** (server-only cookie I/O): `readAssumedRoleCookie`
  (fail-safe → null outside a request scope), `setAssumedRoleCookie` (httpOnly + secure + lax),
  `clearAssumedRoleCookie`.
- **`src/lib/auth/require-role.ts`** — `loadUserContext` applies `resolveEffectiveRole(row.role,
cookie)`; `ctx.role` (allowlist check, `roleHome`, nav builders) follows.
- **`src/lib/auth/action-gate.ts`** — `requireActionRole` gates on the effective role.
- **`src/app/settings/roles-view-as/actions.ts`** — `setAssumedRole` / `clearAssumedRole`, gated on the
  REAL super_admin (bypass the override so exit never sticks).
- **`src/app/auth/logout/route.ts`** — also clears the cookie.

## 4. Units

### U1 — backend core ✅ (2026-07-07)

The resolver + cookie I/O + both gate wirings + enter/exit actions + logout-clear. **TDD**:
`tests/unit/effective-role.test.ts` (allowlist + forge-guard + override), `require-role.test.ts` +
`action-gate.test.ts` (gates honor the override; forge-guard), `roles-view-as-actions.test.ts`
(enter/exit gate on real role), `logout-route.test.ts` (clears cookie). Full suite green.

### U2 — UI (not started)

- Card "ดูมุมมองตาม role" in the Settings admin section (`src/app/settings/sections.ts`, `admin` key,
  super_admin-only) → role picker over `ASSUMABLE_ROLES` (Thai labels via `labels.ts`) posting
  `setAssumedRole`.
- Persistent global exit banner in the root layout — shown only when real-role is super_admin AND a
  cookie is active; posts `clearAssumedRole`. Global so exit works from any page (incl. empty/stub views).
- "ไม่มีข้อมูลส่วนตัวในมุมมองนี้ (กำลังดูในฐานะ super_admin)" placeholder on `/technician`, `/portal`,
  `/client` so identity-scoped emptiness reads as intentional.
- Assumed-role `audit_log` write on enter/exit.

### U3 — write fidelity (optional, later)

Replace the ~30 inline `from("users").select("role")` role reads with a shared effective-role helper so
the assumed role gates them too (also removes the copy-paste). Touches money/labor/nova/projects action
files — land separately.

## 5. Out of scope (v1)

User-impersonation (become a specific person) · DB-layer role fidelity (request-scoped GUC) · assuming
`/coming-soon` roles.
