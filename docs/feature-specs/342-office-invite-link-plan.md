# Spec 342 — invite-only office onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Load the repo's `ship-unit` skill for the PR gates.

**Goal:** Office onboarding becomes invite-only: a super_admin mints a reusable `/register/office?by=<uuid>&role=<key>` link on `/settings/roles`; the applicant sees the invited role as read-only fact; a bare `/register/office` renders a gate screen; the approver's selector prefills from the invited role.

**Architecture:** Zero schema. `invited_by` and `declared_role_hint` (existing columns) carry the attribution; the role key rides the URL through the LINE login round-trip via `registerLoginNext`'s bindings group. One new pure module (`office-roles.ts`) becomes the shared SSOT for the field/office role partition and the hint→role parse used by the door, the form, and the approver sheet.

**Tech Stack:** Next.js 16 App Router, Vitest + RTL (jsdom), existing register-flow modules. No new dependencies.

**Read the spec first:** `docs/feature-specs/342-office-invite-link.md` — decisions D1–D8 are binding. This plan implements exactly that spec.

## Global Constraints

- **TDD, RED first** — the failing test is written and SEEN to fail before production code. First message of each task: "Writing failing test first."
- **PR shape:** Tasks 1–9 = **PR A** (spec U1+U2 — one PR because U1 alone mints links the door drops, U2 alone locks the door with no key: each half removes what the other re-homes, doctrine §2). Task 10 ships it. Task 11 = **PR B** (spec U3, additive). Both code-only, no danger-path files → auto-merge on green.
- **Machine quirks:** `cd /d/claude/projects/prc-ops/prc-ops &&` in EVERY Bash command (cwd resets). `export PATH="/c/Program Files/nodejs:$PATH"` before pnpm. Thai text via Edit/Write tools ONLY, never PowerShell heredocs. NEVER `pnpm format` (use `pnpm exec prettier --write <file>` if needed).
- **Scope discipline:** implement exactly this plan. No extra validation, helpers, or "while I'm here" fixes.
- **Do NOT touch:** `src/lib/auth/**` (CI danger regex — costs the auto-merge), `role-home.ts`'s `STAFF_ONBOARDABLE_ROLES` typing, any migration.
- **Copy assertions house rule:** constants asserted ≥2 occurrences (`src.split(NAME).length - 1 >= 2`), retired literals pinned BARE (`not.toContain("/register/office")` style, not quote-wrapped), never let a code comment quoting a UI string satisfy a presence pin. Mutation-check every text assertion (break prod code by hand → RED → restore).
- Lane `342invite` is claimed in `../LANES.md`, branch `spec342-office-invite` exists with the spec commit. Work in the main dir `D:\claude\projects\prc-ops\prc-ops` on that branch.

---

## PR A — mint + door (spec U1 + U2)

### Task 1: `office-roles.ts` — the shared role-partition SSOT

**Files:**

- Create: `src/lib/register/office-roles.ts`
- Modify: `src/components/features/registrations/registration-decision.tsx:65-68` (import instead of local consts)
- Test: `tests/unit/office-roles.test.ts`

**Interfaces:**

- Consumes: `STAFF_ONBOARDABLE_ROLES`, `isStaffOnboardableRole`, `type UserRole` from `@/lib/auth/role-home` (read-only import — importing from `src/lib/auth` is fine; _editing_ it is not).
- Produces: `FIELD_ROLE_OPTIONS: readonly UserRole[]`, `OFFICE_ROLE_OPTIONS: readonly UserRole[]`, `invitedRoleFromHint(hint: string | null | undefined): UserRole | null`. Tasks 3, 5, 6, 9, 11 import these.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/office-roles.test.ts
// Writing failing test first.
//
// Spec 342 U1.2 — the field/office role partition, lifted out of the
// registration-decision client component so /settings/roles can mint from it,
// plus the hint→role parse (D6: declared_role_hint holds a role KEY for
// invited applicants, legacy prose otherwise).

import { describe, expect, it } from "vitest";
import {
  FIELD_ROLE_OPTIONS,
  OFFICE_ROLE_OPTIONS,
  invitedRoleFromHint,
} from "@/lib/register/office-roles";
import { STAFF_ONBOARDABLE_ROLES } from "@/lib/auth/role-home";

describe("office-roles partition", () => {
  it("field options are exactly technician + site_admin", () => {
    expect(FIELD_ROLE_OPTIONS).toEqual(["technician", "site_admin"]);
  });

  it("field + office partition STAFF_ONBOARDABLE_ROLES exactly (no loss, no overlap)", () => {
    const union = [...FIELD_ROLE_OPTIONS, ...OFFICE_ROLE_OPTIONS];
    expect([...union].sort()).toEqual([...STAFF_ONBOARDABLE_ROLES].sort());
    expect(new Set(union).size).toBe(union.length);
  });
});

describe("invitedRoleFromHint", () => {
  it("parses an onboardable role key", () => {
    expect(invitedRoleFromHint("procurement")).toBe("procurement");
    expect(invitedRoleFromHint(" legal ")).toBe("legal");
  });

  it("rejects legacy prose, blanks, and non-onboardable roles", () => {
    expect(invitedRoleFromHint("จัดซื้อ")).toBeNull();
    expect(invitedRoleFromHint("")).toBeNull();
    expect(invitedRoleFromHint(null)).toBeNull();
    expect(invitedRoleFromHint(undefined)).toBeNull();
    // in the DB guard's 13-role list but NOT onboardable — must not prefill
    expect(invitedRoleFromHint("project_director")).toBeNull();
    expect(invitedRoleFromHint("super_admin")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/office-roles.test.ts`
Expected: FAIL — `Cannot find module '@/lib/register/office-roles'`

- [ ] **Step 3: Write the module**

```ts
// src/lib/register/office-roles.ts
// Spec 342 U1.2 — the field/office partition of STAFF_ONBOARDABLE_ROLES,
// lifted from registration-decision.tsx (where both consts were module-private
// inside a "use client" component) so /settings/roles can mint invite links
// from the same SSOT. Pure — no DB, no client directive.
//
// invitedRoleFromHint: spec 342 D6 — declared_role_hint carries a role KEY for
// invited office applicants ("procurement") and free prose for legacy rows
// ("จัดซื้อ"). Anything that parses as an onboardable role is prefill-able;
// everything else is display-only prose. The DB-side approve guard admits 13
// roles (a superset) — this parse must use the NARROW onboardable set, never
// that list, or a hand-tampered link could prefill e.g. project_director.

import {
  STAFF_ONBOARDABLE_ROLES,
  isStaffOnboardableRole,
  type UserRole,
} from "@/lib/auth/role-home";

/** Spec 333 U2a grouping: the two roles approved for on-site work. */
export const FIELD_ROLE_OPTIONS: readonly UserRole[] = ["technician", "site_admin"];

/** The office group = every other onboardable role (operator-tunable via the
 * STAFF_ONBOARDABLE_ROLES SSOT — this derives, never restates). */
export const OFFICE_ROLE_OPTIONS: readonly UserRole[] = STAFF_ONBOARDABLE_ROLES.filter(
  (r) => !FIELD_ROLE_OPTIONS.includes(r),
);

/** Parse a declared_role_hint (or a ?role URL param — same trust level) into an
 * onboardable role, or null for prose/blank/garbage. */
export function invitedRoleFromHint(hint: string | null | undefined): UserRole | null {
  const trimmed = hint?.trim() ?? "";
  if (!trimmed) return null;
  return isStaffOnboardableRole(trimmed as UserRole) ? (trimmed as UserRole) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/office-roles.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Rewire registration-decision.tsx (behavior-preserving)**

In `src/components/features/registrations/registration-decision.tsx`, DELETE the local consts at lines 65-68:

```ts
const FIELD_ROLE_OPTIONS: readonly UserRole[] = ["technician", "site_admin"];
const OFFICE_ROLE_OPTIONS: readonly UserRole[] = STAFF_ONBOARDABLE_ROLES.filter(
  (r) => !FIELD_ROLE_OPTIONS.includes(r),
);
```

and add to the imports:

```ts
import { FIELD_ROLE_OPTIONS, OFFICE_ROLE_OPTIONS } from "@/lib/register/office-roles";
```

The `STAFF_ONBOARDABLE_ROLES` import at line 37 becomes unused — remove it from that import statement (keep `type UserRole`). Update the spec-333 comment above the deleted consts to note the consts now live in `@/lib/register/office-roles` (spec 342 U1.2). The rendered optgroups must not change.

- [ ] **Step 6: Run the existing decision-sheet tests to prove behavior preserved**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/registration-decision-defer.test.tsx tests/unit/registration-decision-firm.test.tsx tests/unit/registration-decision-site.test.tsx tests/unit/registration-decision-send-back.test.tsx tests/unit/role-sets.test.ts`
Expected: PASS, all files

- [ ] **Step 7: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops && git add src/lib/register/office-roles.ts src/components/features/registrations/registration-decision.tsx tests/unit/office-roles.test.ts && git commit -m "feat(register): lift field/office role partition into office-roles.ts (spec 342 U1.2)"
```

---

### Task 2: `officeInviteUrl` — the mint builder

**Files:**

- Modify: `src/lib/register/onboard-link.ts`
- Test: `tests/unit/onboard-link.test.ts` (exists — append a describe block)

**Interfaces:**

- Consumes: `REGISTER_OFFICE_PATH` from `@/lib/register/register-entry`; `isStaffOnboardableRole`, `type UserRole` from `@/lib/auth/role-home`.
- Produces: `officeInviteUrl(base: string, opts: { inviterId: string; role: UserRole }): string | null` — null when the role is not onboardable (runtime refusal per spec U1.1; compile-time is impossible without re-typing the auth constant). Task 9 consumes.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/onboard-link.test.ts`:

```ts
// Spec 342 U1.1 — the reusable office invite link. `by` is the inviter's own
// uuid (server-supplied at the call site), `role` an onboardable role KEY.
// Refusal is runtime (isStaffOnboardableRole): the STAFF_ONBOARDABLE_ROLES
// annotation erases literal types, and re-typing it means editing
// src/lib/auth/** — a danger-path file (fact-check finding 2026-07-22).
describe("officeInviteUrl", () => {
  const INVITER = "223e4567-e89b-12d3-a456-426614174000";

  it("mints /register/office with by + role", () => {
    const url = officeInviteUrl("https://app.example.com", {
      inviterId: INVITER,
      role: "procurement",
    });
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/register/office");
    expect(parsed.searchParams.get("by")).toBe(INVITER);
    expect(parsed.searchParams.get("role")).toBe("procurement");
  });

  it("refuses a non-onboardable role at runtime", () => {
    expect(
      officeInviteUrl("https://app.example.com", {
        inviterId: INVITER,
        role: "super_admin" as never,
      }),
    ).toBeNull();
  });
});
```

Add `officeInviteUrl` to the file's existing import from `@/lib/register/onboard-link`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/onboard-link.test.ts`
Expected: FAIL — `officeInviteUrl` is not exported

- [ ] **Step 3: Implement** — append to `src/lib/register/onboard-link.ts`:

```ts
// Spec 342 U1.1 — the reusable per-inviter OFFICE invite link
// (/register/office?by=<inviter uuid>&role=<onboardable role key>). Same pure
// style as technicianOnboardUrl. No ?project (D7 — office staff are not
// project-bound) and no display label (the role label is derived from the key
// at render via USER_ROLE_LABEL). Returns null for a non-onboardable role:
// the refusal is runtime-only, because STAFF_ONBOARDABLE_ROLES's
// ReadonlyArray<UserRole> annotation erases the literal types and re-typing it
// would touch src/lib/auth/** (danger path). The role in the URL is advisory
// end-to-end (D5) — the approver's confirm is the only binding.
export function officeInviteUrl(
  base: string,
  opts: { inviterId: string; role: UserRole },
): string | null {
  if (!isStaffOnboardableRole(opts.role)) return null;
  const url = new URL(REGISTER_OFFICE_PATH, base);
  url.searchParams.set("by", opts.inviterId);
  url.searchParams.set("role", opts.role);
  return url.toString();
}
```

Add imports at the top of `onboard-link.ts`:

```ts
import { isStaffOnboardableRole, type UserRole } from "@/lib/auth/role-home";
import { REGISTER_OFFICE_PATH } from "@/lib/register/register-entry";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/onboard-link.test.ts`
Expected: PASS (existing + 2 new)

- [ ] **Step 5: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops && git add src/lib/register/onboard-link.ts tests/unit/onboard-link.test.ts && git commit -m "feat(register): officeInviteUrl mint builder (spec 342 U1.1)"
```

---

### Task 3: `officeInviteParams` + `role` through the login round-trip

**Files:**

- Modify: `src/lib/register/register-entry.ts`
- Test: `tests/unit/register-entry.test.ts` (append describe blocks; the VISITOR_REGISTER_ENTRIES rewrite is Task 8, NOT here)

**Interfaces:**

- Consumes: `invitedRoleFromHint` from Task 1; existing `isValidUuid`, `safeNextPath`.
- Produces: `interface OfficeInvite { by: string; role: UserRole }`; `officeInviteParams(params: { by?: string | undefined; role?: string | undefined }): OfficeInvite | null`; `RegisterQrParams` gains `role?: string | undefined`; `registerLoginNext` threads a valid `role` in its **bindings** group. Task 6 consumes.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/register-entry.test.ts`:

```ts
// Spec 342 U2.1 — the office invite parse + the role's login round-trip.
// `role` joins the BINDINGS group of registerLoginNext (not the droppable
// label group): a role key is neither a uuid nor display text, and it must
// survive the label-dropping fallback. The logged-out leg is the historically
// fragile one — the static next-path silently orphaned all 18 real
// registrations' attribution (0/18 invited_by, PR #677).
describe("officeInviteParams", () => {
  const BY = "223e4567-e89b-12d3-a456-426614174000";

  it("accepts a uuid inviter + onboardable role", () => {
    expect(officeInviteParams({ by: BY, role: "accounting" })).toEqual({
      by: BY,
      role: "accounting",
    });
  });

  it("rejects missing/malformed by, missing/prose/non-onboardable role", () => {
    expect(officeInviteParams({ role: "accounting" })).toBeNull();
    expect(officeInviteParams({ by: "not-a-uuid", role: "accounting" })).toBeNull();
    expect(officeInviteParams({ by: BY })).toBeNull();
    expect(officeInviteParams({ by: BY, role: "จัดซื้อ" })).toBeNull();
    expect(officeInviteParams({ by: BY, role: "super_admin" })).toBeNull();
  });
});

describe("registerLoginNext — office invite role threading", () => {
  const BY = "223e4567-e89b-12d3-a456-426614174000";

  it("keeps by + role across the round trip", () => {
    const next = registerLoginNext("office", { by: BY, role: "hr" });
    const decoded = decodeURIComponent(next.slice("/login?next=".length));
    const parsed = new URL(decoded, "https://prc.invalid");
    expect(parsed.pathname).toBe("/register/office");
    expect(parsed.searchParams.get("by")).toBe(BY);
    expect(parsed.searchParams.get("role")).toBe("hr");
  });

  it("drops a garbage role but keeps the by binding", () => {
    const next = registerLoginNext("office", { by: BY, role: "<script>" });
    const decoded = decodeURIComponent(next.slice("/login?next=".length));
    const parsed = new URL(decoded, "https://prc.invalid");
    expect(parsed.searchParams.get("by")).toBe(BY);
    expect(parsed.searchParams.get("role")).toBeNull();
  });
});
```

Add `officeInviteParams` to the file's import from `@/lib/register/register-entry`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/register-entry.test.ts`
Expected: FAIL — `officeInviteParams` not exported (the two new describes; existing tests still green)

- [ ] **Step 3: Implement in `register-entry.ts`**

Add to imports: `import { invitedRoleFromHint } from "@/lib/register/office-roles";` and `import type { UserRole } from "@/lib/auth/role-home";`

Extend `RegisterQrParams` (after the `firm` member):

```ts
  /** Spec 342 — the office invite's role KEY (advisory, D5). */
  role?: string | undefined;
```

In `registerLoginNext`, after the uuid-bindings loop, add the role to the **bindings** group:

```ts
const role = invitedRoleFromHint(params?.role);
if (role) bindings.set("role", role);
```

(The `full = new URLSearchParams(bindings)` copy already happens after — move the role line ABOVE that copy so both candidates carry it.)

Append the invite parse:

```ts
/** Spec 342 U2.1 — a valid office invite = a uuid-shaped `by` AND an
 * onboardable `role`, both from the URL. UX gate only (D4): the uuid is not
 * verified to belong to a real inviter — anyone past this gate is merely an
 * applicant, and every approval floor sits downstream. */
export interface OfficeInvite {
  by: string;
  role: UserRole;
}

export function officeInviteParams(params: {
  by?: string | undefined;
  role?: string | undefined;
}): OfficeInvite | null {
  const role = invitedRoleFromHint(params.role);
  if (!isValidUuid(params.by) || !role) return null;
  return { by: params.by, role };
}
```

(`isValidUuid` narrows `params.by` to `string` — it is already imported in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/register-entry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops && git add src/lib/register/register-entry.ts tests/unit/register-entry.test.ts && git commit -m "feat(register): officeInviteParams + role through the login round-trip (spec 342 U2.1)"
```

---

### Task 4: labels

**Files:**

- Modify: `src/lib/i18n/labels.ts` (append near the REGISTER\_\* block at ~line 930)

**Interfaces:**

- Produces (consumed by Tasks 5, 6, 8, 9, 11):

- [ ] **Step 1: Add the labels** (Edit tool — Thai text, never PowerShell):

```ts
// Spec 342 — invite-only office onboarding.
/** The read-only invited-role line on the register form + the approver sheet. */
export const INVITED_ROLE_LABEL = "ตำแหน่งที่เชิญ";
/** The /register/office gate screen (no valid invite link). */
export const OFFICE_INVITE_REQUIRED_HEADING = "หน้านี้ต้องเปิดจากลิงก์เชิญ";
export const OFFICE_INVITE_REQUIRED_HINT =
  "การสมัครงานสำนักงานต้องใช้ลิงก์เชิญ กรุณาติดต่อฝ่ายบุคคลหรือผู้จัดการเพื่อขอลิงก์";
/** The /coming-soon replacement line for the retired office door. */
export const OFFICE_ASK_INVITE_LINE = "สมัครงานสำนักงาน? ติดต่อฝ่ายบุคคลเพื่อขอลิงก์เชิญ";
/** The /settings/roles mint block. */
export const OFFICE_INVITE_BLOCK_TITLE = "ลิงก์เชิญพนักงานออฟฟิศ";
export const OFFICE_INVITE_BLOCK_HINT =
  "สร้างลิงก์เชิญตามตำแหน่ง ส่งให้ผู้สมัครทาง LINE — ลิงก์ใช้ซ้ำได้ ผู้อนุมัติยืนยันตำแหน่งอีกครั้งตอนอนุมัติ";
```

No test of its own — every label is pinned by the component test that renders it (Tasks 5, 6, 8, 9). No commit yet; rides with Task 5's commit.

---

### Task 5: `StaffRegistrationForm` — locked role, hidden hint box

**Files:**

- Modify: `src/components/features/register/staff-registration-form.tsx`
- Test: `tests/unit/staff-registration-form-invited-role.test.tsx` (new)

**Interfaces:**

- Consumes: `INVITED_ROLE_LABEL` (Task 4), `USER_ROLE_LABEL` (exists in labels.ts), `type UserRole`.
- Produces: prop `invitedRole?: UserRole | null` (default `null`). When set: the free-text hint input does NOT render; a read-only `ตำแหน่งที่เชิญ` line renders instead. Submit payload is unchanged — the workspace seeds `initial.declaredRoleHint` with the role key, and the existing state → `startStaffRegistration({ declaredRoleHint })` path carries it (spec U2.4: written at first submit, because the post-submit redirect loses the URL).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/staff-registration-form-invited-role.test.tsx
// Writing failing test first.
//
// Spec 342 D2 — an invited office applicant sees the role as read-only fact:
// no input, nothing to get wrong. The free-text
// "คาดว่าจะทำงานตำแหน่งใด" box must be ABSENT (absence pin, not just
// label presence), and the uninvited form must keep it.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/register/actions", () => ({
  startStaffRegistration: vi.fn(),
  updateOwnStaffRegistration: vi.fn(),
  addStaffRegistrationDoc: vi.fn(),
  recordOwnStaffConsent: vi.fn(),
  recordOwnStaffBank: vi.fn(),
}));

import { StaffRegistrationForm } from "@/components/features/register/staff-registration-form";
import { INVITED_ROLE_LABEL, USER_ROLE_LABEL } from "@/lib/i18n/labels";

const BLANK_INITIAL = {
  fullName: "",
  phone: "",
  dob: "",
  emergencyName: "",
  emergencyRelation: "",
  emergencyPhone: "",
  declaredRoleHint: "",
  bankName: "",
  accountNumber: "",
  accountName: "",
};

function renderForm(invitedRole: "accounting" | null) {
  return render(
    <StaffRegistrationForm
      registrationExists={false}
      uid={null}
      docUrls={{}}
      consentedAt={null}
      invitedRole={invitedRole}
      initial={{ ...BLANK_INITIAL, declaredRoleHint: invitedRole ?? "" }}
    />,
  );
}

describe("StaffRegistrationForm — invited role (spec 342)", () => {
  it("invited: shows the role as read-only text and renders NO hint input", () => {
    renderForm("accounting");
    expect(screen.getByText(INVITED_ROLE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(USER_ROLE_LABEL.accounting)).toBeInTheDocument();
    expect(screen.queryByLabelText(/คาดว่าจะทำงานตำแหน่งใด/)).not.toBeInTheDocument();
  });

  it("uninvited: keeps the free-text hint box and shows no invited-role line", () => {
    renderForm(null);
    expect(screen.getByLabelText(/คาดว่าจะทำงานตำแหน่งใด/)).toBeInTheDocument();
    expect(screen.queryByText(INVITED_ROLE_LABEL)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/staff-registration-form-invited-role.test.tsx`
Expected: FAIL — unknown prop / hint input renders in the invited case

- [ ] **Step 3: Implement**

In `staff-registration-form.tsx`:

a. Props (`StaffRegistrationFormProps`, after `bankExempt`):

```ts
  /** Spec 342 D2 — the invite link's role (or the pending row's parsed
   *  declared_role_hint). Non-null → the role renders as read-only fact and
   *  the free-text hint input does not render. The submitted
   *  declaredRoleHint still comes from `initial` (the workspace seeds it with
   *  the role key), so the mint writes it — spec U2.4. */
  invitedRole?: UserRole | null;
```

Destructure with `invitedRole = null`. Add imports: `type UserRole` from `@/lib/auth/role-home`; `INVITED_ROLE_LABEL, USER_ROLE_LABEL` added to the existing `@/lib/i18n/labels` import.

b. Replace the hint `<label>` block (currently at ~line 220-233) with:

```tsx
{
  invitedRole ? (
    <div className="mt-3">
      <p className="text-ink-secondary text-sm">{INVITED_ROLE_LABEL}</p>
      <p className="text-ink mt-0.5 text-base font-semibold">{USER_ROLE_LABEL[invitedRole]}</p>
    </div>
  ) : (
    <label className="text-ink-secondary mt-3 block text-sm">
      คาดว่าจะทำงานตำแหน่งใด (ไม่บังคับ)
      <input
        value={declaredRoleHint}
        maxLength={120}
        disabled={pending}
        placeholder="เช่น ช่างเทคนิค, จัดซื้อ"
        onChange={(e) => {
          setDeclaredRoleHint(e.target.value);
          clear();
        }}
        className={FIELD_STACKED}
      />
    </label>
  );
}
```

(The input branch is byte-identical to today's.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/staff-registration-form-invited-role.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Mutation-check the absence pin**

By hand, temporarily make the invited branch ALSO render the input (add the `<label>` block inside the `invitedRole ?` branch) → the first test must go RED. Restore. Record the RED output.

- [ ] **Step 6: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops && git add src/lib/i18n/labels.ts src/components/features/register/staff-registration-form.tsx tests/unit/staff-registration-form-invited-role.test.tsx && git commit -m "feat(register): locked invited-role display on the registration form (spec 342 D2)"
```

---

### Task 6: workspace + office page — the door itself

**Files:**

- Create: `src/components/features/register/office-invite-gate.tsx`
- Modify: `src/components/features/register/staff-register-workspace.tsx`, `src/app/register/office/page.tsx`
- Test: `tests/unit/staff-register-workspace-login-next.test.tsx` (extend), `tests/unit/office-invite-gate.test.tsx` (new)

**Interfaces:**

- Consumes: `officeInviteParams`, `registerLoginNext` (Task 3); `invitedRoleFromHint` (Task 1); form prop `invitedRole` (Task 5); labels (Task 4).
- Produces: `/register/office` accepts `?by&role`; the check order is **auth → existing registration → valid invite → gate**, so an applicant with a pending registration always reaches their status view even without params.

- [ ] **Step 1: Write the failing tests**

New `tests/unit/office-invite-gate.test.tsx`:

```tsx
// Writing failing test first.
// Spec 342 D3 — the gate is a guidance screen, never a 404: it names the
// requirement, offers the field door, and says who to ask.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfficeInviteGate } from "@/components/features/register/office-invite-gate";
import {
  OFFICE_INVITE_REQUIRED_HEADING,
  OFFICE_INVITE_REQUIRED_HINT,
  REGISTER_FIELD_HEADING,
} from "@/lib/i18n/labels";

describe("OfficeInviteGate", () => {
  it("explains the invite requirement and offers the field door", () => {
    render(<OfficeInviteGate />);
    expect(screen.getByText(OFFICE_INVITE_REQUIRED_HEADING)).toBeInTheDocument();
    expect(screen.getByText(OFFICE_INVITE_REQUIRED_HINT)).toBeInTheDocument();
    const fieldDoor = screen.getByRole("link", { name: REGISTER_FIELD_HEADING });
    expect(fieldDoor).toHaveAttribute("href", "/register/technician");
  });
});
```

Extend `tests/unit/staff-register-workspace-login-next.test.tsx` — REPLACE the third test (`"the office door (no QR params by design) is unchanged"` — its premise is retired by this spec) with:

```tsx
it("office door with an invite keeps by + role across the login round-trip", async () => {
  const url = await captureRedirect({ variant: "office", by: BY, role: "legal" });
  const next = decodeURIComponent(url.slice("/login?next=".length));
  const parsed = new URL(next, "https://prc.invalid");
  expect(parsed.pathname).toBe("/register/office");
  expect(parsed.searchParams.get("by")).toBe(BY);
  expect(parsed.searchParams.get("role")).toBe("legal");
});

it("office door without params keeps the historical bare path", async () => {
  const url = await captureRedirect({ variant: "office" });
  expect(url).toBe("/login?next=%2Fregister%2Foffice");
});
```

- [ ] **Step 2: Run to verify RED**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/office-invite-gate.test.tsx tests/unit/staff-register-workspace-login-next.test.tsx`
Expected: FAIL — gate module missing; workspace has no `role` prop (TS + param not threaded)

- [ ] **Step 3: Implement**

a. `src/components/features/register/office-invite-gate.tsx` (server-renderable, no client directive):

```tsx
// Spec 342 D3 — what a bare /register/office renders. A guidance screen, not a
// 404: someone TOLD to open this URL must learn what to do next, not dead-end.
// The organic office door is closed (invite-only); the field door stays open.
import Link from "next/link";
import { CARD, BUTTON_SECONDARY } from "@/lib/ui/classes";
import { REGISTER_FIELD_PATH } from "@/lib/register/register-entry";
import {
  OFFICE_INVITE_REQUIRED_HEADING,
  OFFICE_INVITE_REQUIRED_HINT,
  REGISTER_FIELD_HEADING,
} from "@/lib/i18n/labels";

export function OfficeInviteGate() {
  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">{OFFICE_INVITE_REQUIRED_HEADING}</p>
      <p className="text-ink-muted mt-1 text-sm">{OFFICE_INVITE_REQUIRED_HINT}</p>
      <Link href={REGISTER_FIELD_PATH} className={`${BUTTON_SECONDARY} mt-3 w-full`}>
        {REGISTER_FIELD_HEADING}
      </Link>
    </div>
  );
}
```

b. `staff-register-workspace.tsx`:

- Props += `role?: string | undefined;` with doc comment `/** Spec 342 — the office invite's ?role key (advisory, D5). */`
- Imports += `officeInviteParams` (from register-entry), `invitedRoleFromHint` (from office-roles), `OfficeInviteGate`.
- After `const copy = …`: `const officeInvite = variant === "office" ? officeInviteParams({ by, role }) : null;`
- Logged-out redirect gains role: `redirect(registerLoginNext(variant, { project, site, by, contractor, firm, role }));`
- The fresh-form branch (`!registration ? …`) becomes:

```tsx
        {!registration ? (
          variant === "office" && officeInvite === null ? (
            // Spec 342 D3 — no valid invite, no existing registration: the
            // organic office door is closed. Order matters: an applicant WITH a
            // registration never sees this gate (the status view wins below).
            <OfficeInviteGate />
          ) : (
            <StaffRegistrationForm
              registrationExists={false}
              uid={null}
              docUrls={{}}
              consentedAt={null}
              invitedBy={variant === "office" ? (officeInvite?.by ?? null) : (by ?? null)}
              invitedProjectId={project ?? null}
              invitedContractorId={contractorParam}
              bankExempt={subconFresh}
              invitedRole={officeInvite?.role ?? null}
              initial={{
                fullName: "",
                phone: "",
                dob: "",
                emergencyName: "",
                emergencyRelation: "",
                emergencyPhone: "",
                declaredRoleHint: officeInvite?.role ?? "",
                bankName: "",
                accountNumber: "",
                accountName: "",
              }}
            />
          )
        ) : (
```

- In `RegistrationWorkspace` (the pending-resume form at ~line 242), add to the `<StaffRegistrationForm>`: `invitedRole={invitedRoleFromHint(registration.declared_role_hint)}` — a resumed invited applicant keeps the locked view (D2); legacy prose rows parse to null and keep the input.
- Update the STALE header comment at lines 58-62 (`the office door omits them`): the office door now forwards `?by` + `?role` (spec 342); it still has no project/site/firm.

c. `src/app/register/office/page.tsx` — becomes:

```tsx
// Spec 286 U1 — the office-role self-onboard door. Spec 342 — now INVITE-ONLY:
// the door forwards ?by (inviter uuid) + ?role (advisory role key) and the
// workspace renders a gate screen when they are absent/invalid. The role in
// the URL never binds — the approver confirms at approval (D5).

import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";
import { REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";

export const metadata = { title: REGISTER_OFFICE_HEADING };

export default async function RegisterOfficePage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; role?: string }>;
}) {
  const { by, role } = await searchParams;
  return <StaffRegisterWorkspace variant="office" by={by} role={role} />;
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/office-invite-gate.test.tsx tests/unit/staff-register-workspace-login-next.test.tsx tests/unit/staff-register-workspace-docs-owed.test.tsx`
Expected: PASS all three files (docs-owed proves no collateral)

- [ ] **Step 5: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops && git add src/components/features/register/office-invite-gate.tsx src/components/features/register/staff-register-workspace.tsx src/app/register/office/page.tsx tests/unit/office-invite-gate.test.tsx tests/unit/staff-register-workspace-login-next.test.tsx && git commit -m "feat(register): invite-only office door with gate screen (spec 342 U2)"
```

---

### Task 7: submit action — nothing to change, verify and move on

**Files:** none modified. `startStaffRegistration` (`src/lib/register/actions.ts:30-77`) already accepts `invitedBy` (uuid-gated, existence-coerced by the RPC) and `declaredRoleHint` (free text — the role key is just a value of it). The form (Task 5) and workspace (Task 6) seed both.

- [ ] **Step 1: Run the existing action tests to confirm no regression**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/register-actions-invited.test.ts`
Expected: PASS, unchanged. No commit.

---

### Task 8: close the /coming-soon office door

**Files:**

- Modify: `src/lib/register/register-entry.ts` (VISITOR_REGISTER_ENTRIES), `src/components/features/register/visitor-landing.tsx`
- Test: `tests/unit/register-entry.test.ts` (rewrite the VISITOR_REGISTER_ENTRIES describe), `tests/unit/visitor-landing.test.tsx` (rewrite the office-door test)

These two tests go RED here **by design** — they are the guard doing its job (named in the spec's Testing section). Rewrite them deliberately.

- [ ] **Step 1: Rewrite the two tests first (RED)**

In `tests/unit/register-entry.test.ts`, replace the `VISITOR_REGISTER_ENTRIES` describe with:

```ts
describe("VISITOR_REGISTER_ENTRIES", () => {
  // Spec 342 D3 — the office door is invite-only; /coming-soon offers ONLY the
  // field door. Absence pinned BARE (house rule).
  it("offers only the on-site door", () => {
    expect(VISITOR_REGISTER_ENTRIES.map((e) => e.path)).toEqual(["/register/technician"]);
    expect(VISITOR_REGISTER_ENTRIES.map((e) => e.path)).not.toContain("/register/office");
  });

  it("labels the door with the field heading", () => {
    expect(VISITOR_REGISTER_ENTRIES[0]?.label).toBe(REGISTER_FIELD_HEADING);
  });
});
```

In `tests/unit/visitor-landing.test.tsx`, replace the two-door test with:

```tsx
it("offers the field door only; office becomes an ask-for-a-link line", () => {
  render(<VisitorLanding greeting="สวัสดี" lineAvatarUrl={null} fullName={null} />);

  const field = screen.getByRole("link", { name: REGISTER_FIELD_HEADING });
  expect(field).toHaveAttribute("href", "/register/technician");
  // Spec 342 D3 — no office LINK; the line names who to ask instead.
  expect(screen.queryByRole("link", { name: REGISTER_OFFICE_HEADING })).not.toBeInTheDocument();
  expect(screen.getByText(OFFICE_ASK_INVITE_LINE)).toBeInTheDocument();
});
```

Add `OFFICE_ASK_INVITE_LINE` to that file's labels import.

- [ ] **Step 2: Run to verify RED**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/register-entry.test.ts tests/unit/visitor-landing.test.tsx`
Expected: FAIL — both rewritten tests (entries still 2, link still rendered)

- [ ] **Step 3: Implement**

a. `register-entry.ts` — replace the `VISITOR_REGISTER_ENTRIES` const and its comment:

```ts
/** The self-serve doors offered to an organic visitor on /coming-soon. Spec
 * 342 D3: office is INVITE-ONLY now — only the on-site door remains open;
 * VisitorLanding renders the ask-for-a-link line in the office door's place. */
export const VISITOR_REGISTER_ENTRIES: readonly VisitorRegisterEntry[] = [
  { path: REGISTER_FIELD_PATH, label: REGISTER_FIELD_HEADING },
];
```

(`REGISTER_OFFICE_HEADING` import may become unused in register-entry.ts — it is still used by the `COPY` record, so it stays.)

b. `visitor-landing.tsx` — after the entries `map`, before the subcon/client note, add:

```tsx
<p className="text-ink-secondary text-sm">{OFFICE_ASK_INVITE_LINE}</p>
```

Add `OFFICE_ASK_INVITE_LINE` to the labels import. Update the header comment (lines 8-10): the second door is retired by spec 342 — office is invite-only; the line names who to ask.

- [ ] **Step 4: Run to verify GREEN**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/register-entry.test.ts tests/unit/visitor-landing.test.tsx`
Expected: PASS

- [ ] **Step 5: Mutation-check the absence pin**

Re-add the office entry to `VISITOR_REGISTER_ENTRIES` by hand → both files must go RED. Restore. Record output.

- [ ] **Step 6: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops && git add src/lib/register/register-entry.ts src/components/features/register/visitor-landing.tsx tests/unit/register-entry.test.ts tests/unit/visitor-landing.test.tsx && git commit -m "feat(register): close the organic office door on /coming-soon (spec 342 D3)"
```

---

### Task 9: the mint surface on /settings/roles

**Files:**

- Create: `src/components/features/roles/office-invite-link-block.tsx`
- Modify: `src/app/settings/roles/page.tsx`
- Test: `tests/unit/office-invite-link-block.test.tsx` (new)

**Interfaces:**

- Consumes: `officeInviteUrl` (Task 2), `OFFICE_ROLE_OPTIONS` (Task 1), labels (Task 4), `USER_ROLE_LABEL`.
- Produces: `<OfficeInviteLinkBlock inviterId={string} />` — client island; the inviter id is the calling super_admin's own id, passed server-side from the page (`ctx.id`), never read client-side.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/office-invite-link-block.test.tsx
// Writing failing test first.
//
// Spec 342 U1.3 — the super_admin mint surface: pick an office role, generate,
// copy. The URL is built client-side from window.location.origin (no token, no
// server action — the link is a reusable pure-URL invite, D1).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const success = vi.fn();
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success, error: vi.fn() }),
}));

import { OfficeInviteLinkBlock } from "@/components/features/roles/office-invite-link-block";
import { OFFICE_INVITE_BLOCK_TITLE } from "@/lib/i18n/labels";

const INVITER = "223e4567-e89b-12d3-a456-426614174000";

beforeEach(() => success.mockReset());

describe("OfficeInviteLinkBlock", () => {
  it("generates a link carrying by + the picked role", async () => {
    const user = userEvent.setup();
    render(<OfficeInviteLinkBlock inviterId={INVITER} />);
    expect(screen.getByText(OFFICE_INVITE_BLOCK_TITLE)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("ตำแหน่ง"), "accounting");
    await user.click(screen.getByRole("button", { name: "สร้างลิงก์เชิญ" }));

    const input = screen.getByDisplayValue(/register\/office/) as HTMLInputElement;
    const parsed = new URL(input.value);
    expect(parsed.pathname).toBe("/register/office");
    expect(parsed.searchParams.get("by")).toBe(INVITER);
    expect(parsed.searchParams.get("role")).toBe("accounting");
  });

  it("copies the link to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OfficeInviteLinkBlock inviterId={INVITER} />);
    await user.click(screen.getByRole("button", { name: "สร้างลิงก์เชิญ" }));
    await user.click(screen.getByRole("button", { name: "คัดลอกลิงก์" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("register/office"));
    expect(success).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/office-invite-link-block.test.tsx`
Expected: FAIL — module missing

- [ ] **Step 3: Implement the block** (mirrors `worker-invite-block.tsx`'s shape):

```tsx
"use client";

// Spec 342 U1.3 — the super_admin mint surface on /settings/roles. Pick an
// office role → generate the reusable /register/office?by=&role= link → copy
// for LINE. Pure URL construction (officeInviteUrl), no token and no server
// action: the link is reusable by design (D1) and the role it carries never
// binds (D5 — the approver confirms at approval). The inviter id arrives
// server-supplied from the page (the caller's own ctx.id).
//
// 'use client': select + generated-link state + clipboard copy.

import { useState } from "react";
import { officeInviteUrl } from "@/lib/register/onboard-link";
import { OFFICE_ROLE_OPTIONS } from "@/lib/register/office-roles";
import type { UserRole } from "@/lib/auth/role-home";
import { useToast } from "@/lib/ui/use-toast";
import {
  OFFICE_INVITE_BLOCK_TITLE,
  OFFICE_INVITE_BLOCK_HINT,
  USER_ROLE_LABEL,
} from "@/lib/i18n/labels";
import {
  CARD,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  FIELD_INPUT,
  FIELD_STACKED,
} from "@/lib/ui/classes";

export function OfficeInviteLinkBlock({ inviterId }: { inviterId: string }) {
  const toast = useToast();
  const [role, setRole] = useState<UserRole>(OFFICE_ROLE_OPTIONS[0] ?? "procurement");
  const [url, setUrl] = useState<string | null>(null);

  function generate() {
    setUrl(officeInviteUrl(window.location.origin, { inviterId, role }));
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("คัดลอกลิงก์แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  return (
    <section className={CARD}>
      <p className="text-ink text-sm font-semibold">{OFFICE_INVITE_BLOCK_TITLE}</p>
      <p className="text-ink-muted mt-0.5 text-xs">{OFFICE_INVITE_BLOCK_HINT}</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ตำแหน่ง
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as UserRole);
            setUrl(null);
          }}
          className={FIELD_STACKED}
        >
          {OFFICE_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {USER_ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      {url ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className={FIELD_INPUT}
          />
          <button type="button" onClick={() => void copy()} className={BUTTON_PRIMARY}>
            คัดลอกลิงก์
          </button>
        </div>
      ) : (
        <button type="button" onClick={generate} className={`mt-3 ${BUTTON_SECONDARY_MUTED}`}>
          สร้างลิงก์เชิญ
        </button>
      )}
    </section>
  );
}
```

b. Mount on `src/app/settings/roles/page.tsx` — after the capabilities `<Link>` (line 62), add:

```tsx
{
  /* Spec 342 U1.3 — mint a reusable office invite link (invite-only door). */
}
<OfficeInviteLinkBlock inviterId={ctx.id} />;
```

with `import { OfficeInviteLinkBlock } from "@/components/features/roles/office-invite-link-block";`.

- [ ] **Step 4: Run to verify GREEN**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/office-invite-link-block.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops && git add src/components/features/roles/office-invite-link-block.tsx src/app/settings/roles/page.tsx tests/unit/office-invite-link-block.test.tsx && git commit -m "feat(roles): office invite link mint block on /settings/roles (spec 342 U1.3)"
```

---

### Task 10: PR A gates — full suite, real-flow verify, fresh-eyes, ship

Follow the `ship-unit` skill for the exact gate commands. Plan-specific notes:

- [ ] **Step 1: Full local suite**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm lint && pnpm typecheck && pnpm test 2>&1 | grep -E "✕|×|FAIL|Failed Tests|Tests "`
Expected: 0 failures. If a count without names appears, re-run on a clean tree before theorizing (doctrine — the suite flakes under load).

- [ ] **Step 2: Mutation-check sweep** (any not yet done in-task): ① office entry re-added → Task 8 tests RED; ② hint input rendered while invited → Task 5 RED; ③ gate replaced by the form (`officeInvite === null ? <StaffRegistrationForm…` inverted) → no existing test... **add the coverage instead of skipping**: extend `office-invite-gate.test.tsx`? No — the gate/form fork lives in the workspace. The workspace renders (not redirects) when logged in, which the login-next harness can't reach; cover the fork with the SSR probe in Step 3 and say so in the PR body. ④ `registerLoginNext` role line deleted → Task 3 RED. ⑤ `invitedRole` prop dropped from the pending-resume form → no unit test reaches it; covered by the same SSR probe.

- [ ] **Step 3: Real-flow verify (browser, dev-preview login — memory `dev-preview-login`)**
  1. **Logged-out leg first — the principal that broke last time.** In the preview browser with NO session, open `/register/office?by=<your uid>&role=accounting`. Expect redirect to `/login?next=…`; read the URL and confirm `next` decodes to `/register/office?by=…&role=accounting`. This is the leg that silently orphaned 18 rows.
  2. Log in as dev-preview (super_admin, no staff_registration row). Open the same invite URL: expect the form with `ตำแหน่งที่เชิญ: บัญชี` read-only, NO free-text box, zero console errors.
  3. Open bare `/register/office`: expect the gate screen (heading, hint, field-door button).
  4. Open `/coming-soon` (view-as visitor if needed): field door only + the ask line.
  5. Open `/settings/roles`: mint block renders; pick ฝ่ายบุคคล; generate; the input shows the URL with your uid + `role=hr`; copy toasts.
  6. Do NOT submit a real registration against prod. The write path is proven by `register-actions-invited.test.ts` + the one-week fill-rate query (spec Testing section).

- [ ] **Step 4: Fresh-eyes review** — dispatch the code-review subagent on the full diff (`git diff origin/main...HEAD`). Address every finding with rigor; refute with evidence or fix. (Subagent quirk: pass `model: 'opus'`.)

- [ ] **Step 5: Ship**

```bash
cd /d/claude/projects/prc-ops/prc-ops && scripts/ship-pr.sh
```

PR title: `feat(register): invite-only office onboarding — mint + door (spec 342 U1+U2)`. Body notes: code-only, no schema, danger-path guard expected PASS (no denied paths touched); U1+U2 deliberately one PR (each half removes what the other re-homes); the two rewritten guard tests named. Then update `../LANES.md` (lane 342invite: PR A shipped) and `docs/progress-tracker.md`.

---

## PR B — approver prefill (spec U3)

### Task 11: decision sheet prefills the invited role

**Branch:** after PR A merges, `git fetch && git checkout -b spec342-u3-prefill origin/main`.

**Files:**

- Modify: `src/components/features/registrations/registration-decision.tsx`
- Test: `tests/unit/registration-decision-invited-role.test.tsx` (new)

**Interfaces:**

- Consumes: `invitedRoleFromHint` (in main via PR A), `INVITED_ROLE_LABEL`, `USER_ROLE_LABEL`.
- Produces: selector default = the parsed invited role; firm pre-select still forces `technician` (the RPC's contractor arm refuses anything else — that rule outranks the invite); legacy prose keeps today's `ผู้สมัครระบุว่า:` display and `technician` default.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/registration-decision-invited-role.test.tsx
// Writing failing test first.
//
// Spec 342 U3 — the approver's selector defaults to the invited role when
// declared_role_hint parses as an onboardable role; legacy prose keeps the
// technician default. The URL never binds (D5) — this is a prefill, the
// approver still confirms. A firm pre-select outranks the invite (the RPC's
// contractor arm is technician-only).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/app/registrations/actions", () => ({
  approveStaffRegistration: vi.fn(),
  rejectStaffRegistration: vi.fn(),
  sendBackStaffRegistration: vi.fn(),
}));

import { RegistrationDecision } from "@/components/features/registrations/registration-decision";
import { INVITED_ROLE_LABEL, USER_ROLE_LABEL } from "@/lib/i18n/labels";

const REG = "423e4567-e89b-12d3-a456-426614174000";
const FIRM = "523e4567-e89b-12d3-a456-426614174000";

describe("RegistrationDecision — invited role prefill (spec 342 U3)", () => {
  it("defaults the selector to a parsed role key and labels it as invited", () => {
    render(<RegistrationDecision registrationId={REG} declaredRoleHint="accounting" />);
    expect(screen.getByLabelText("มอบหมายบทบาท")).toHaveValue("accounting");
    expect(
      screen.getByText(`${INVITED_ROLE_LABEL}: ${USER_ROLE_LABEL.accounting}`),
    ).toBeInTheDocument();
  });

  it("legacy prose keeps the technician default and the declared-by display", () => {
    render(<RegistrationDecision registrationId={REG} declaredRoleHint="จัดซื้อ" />);
    expect(screen.getByLabelText("มอบหมายบทบาท")).toHaveValue("technician");
    expect(screen.getByText("ผู้สมัครระบุว่า: จัดซื้อ")).toBeInTheDocument();
  });

  it("a firm pre-select outranks the invited role (contractor arm is technician-only)", () => {
    render(
      <RegistrationDecision
        registrationId={REG}
        declaredRoleHint="accounting"
        contractors={[{ id: FIRM, name: "ช่างอวย" }]}
        invitedContractorId={FIRM}
      />,
    );
    expect(screen.getByLabelText("มอบหมายบทบาท")).toHaveValue("technician");
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/registration-decision-invited-role.test.tsx`
Expected: FAIL — selector value `technician` in test 1, no invited label rendered

- [ ] **Step 3: Implement** in `registration-decision.tsx`:

a. Import `invitedRoleFromHint` from `@/lib/register/office-roles` and add `INVITED_ROLE_LABEL` to the labels import.

b. Above the `useState(role)` line:

```ts
// Spec 342 U3 — prefill from the invite's role key (advisory, D5 — one
// deliberate confirming tap still binds). A firm pre-select outranks it:
// the RPC's contractor arm refuses any role but technician.
const invitedRole = invitedRoleFromHint(declaredRoleHint);
const firmPreselected =
  invitedContractorId !== null && contractors.some((c) => c.id === invitedContractorId);
const [role, setRole] = useState<UserRole>(
  firmPreselected ? DEFAULT_ROLE : (invitedRole ?? DEFAULT_ROLE),
);
```

(Replace the existing `useState<UserRole>(DEFAULT_ROLE)`. The later `contractorId` initial state uses the same predicate — reuse `firmPreselected` there to keep the two in lockstep.)

c. The hint display (line ~236) becomes:

```tsx
{
  invitedRole ? (
    <p className="text-ink-muted text-xs">
      {INVITED_ROLE_LABEL}: {USER_ROLE_LABEL[invitedRole]}
    </p>
  ) : hint ? (
    <p className="text-ink-muted text-xs">ผู้สมัครระบุว่า: {hint}</p>
  ) : null;
}
```

- [ ] **Step 4: Run to verify GREEN, then no-collateral**

Run: `cd /d/claude/projects/prc-ops/prc-ops && export PATH="/c/Program Files/nodejs:$PATH" && pnpm test tests/unit/registration-decision-invited-role.test.tsx tests/unit/registration-decision-defer.test.tsx tests/unit/registration-decision-firm.test.tsx tests/unit/registration-decision-site.test.tsx tests/unit/registration-decision-send-back.test.tsx`
Expected: PASS all five files

- [ ] **Step 5: Mutation-check** — delete the `invitedRole ?? ` fallback branch (make it always `DEFAULT_ROLE`) → test 1 RED; restore. Delete the `firmPreselected ?` guard → test 3 RED; restore.

- [ ] **Step 6: Gates + ship** — `pnpm lint && pnpm typecheck && pnpm test` (grep-filtered per Task 10 Step 1) · browser: open a real pending registration at `/registrations/<id>` as dev-preview and confirm today's behavior unchanged for prose hints (all live hints are prose — zero rows carry role keys yet, so prod renders identically; state that scoped claim in the PR) · fresh-eyes review · `scripts/ship-pr.sh` — title `feat(registrations): prefill approver role from the invite (spec 342 U3)`. Update LANES + tracker; move the lane block to LANES.archive.md when both PRs are merged.

---

## Self-review record

- **Spec coverage:** D1(reusable, Task 2/9) · D2(locked fact, Task 5/6) · D3(door+gate+coming-soon, Task 6/8) · D4(uuid-shape only — `officeInviteParams` does no DB read, Task 3) · D5(advisory at every hop — prefill only, Tasks 3/6/11) · D6(role key into declared_role_hint via `initial`, Task 6; parse fallback tested Tasks 1/11) · D7(no ?project — officeInviteUrl never sets it, Task 2) · D8(super_admin-only — page gate already `requireRole(["super_admin"])`, Task 9) · U2.4 role written at first submit (Task 6 seeds `initial.declaredRoleHint`) · spec's named RED tests (Task 8) · logged-out real-flow (Task 10.3.1) · fill-rate query = post-ship, in spec.
- **Known gap, disclosed:** the workspace's gate/form fork and the pending-resume `invitedRole` pass have no unit test (the existing workspace harness only reaches the logged-out redirect); covered by the SSR/browser probe in Task 10.3 and stated in the PR body. Building a full logged-in workspace render harness (mocking users + registration + docs + consent + bank reads) is out of proportion for this unit — flag as follow-up if fresh-eyes disagrees.
- **Type consistency:** `invitedRole` prop `UserRole | null` everywhere; `officeInviteUrl` returns `string | null`; `officeInviteParams` returns `OfficeInvite | null`; `RegisterQrParams.role` is `string | undefined` (raw URL input) while parsed outputs are `UserRole`.
