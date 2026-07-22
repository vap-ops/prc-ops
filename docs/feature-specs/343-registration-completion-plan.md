# Spec 343 U1 — truthful pending state: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the register workspace telling an applicant they are finished while
two approval-floor items are still outstanding, and put those items where they
can be seen.

**Architecture:** All four defects live in two rendered components plus one pure
module. The approval floor is already computed by the pure
`registrationApprovalFloor`; the only new logic is assembling its input from the
data `RegistrationWorkspace` has already loaded, so the notice (server) and the
form (client) agree on one answer. No schema, no RPC, no new PII surface.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest +
Testing Library (jsdom), Tailwind with the Field-First token system.

## Global constraints

- **NO schema.** Spec 343 is code-only; the schema lane stays free.
- **Thai user-facing strings used on 2+ surfaces go to `src/lib/i18n/labels.ts`** —
  the UI-term SSOT. Never let a raw Postgres error reach the user.
- **Raw Tailwind palette is banned.** Use the `globals.css` token classes already
  present in these files (`text-attn-ink`, `bg-attn-soft`, `text-ink-muted`, …).
- **Touch targets ≥ 44px** (`min-h-11`); `min-h-9` is guard-banned.
- **RED first.** The failing test must exist and be *seen* to fail before any
  production code. State "Writing failing test first."
- **Commit before mutation-checking.** `git checkout --` restores to HEAD, not to
  your working tree — it will silently delete uncommitted work.
- **Scope discipline.** Implement exactly these tasks. No "while I'm here" fixes;
  surface anything else in `docs/progress-tracker.md` open questions.

## Files

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lib/register/registration-floor.ts` | Pure floor model | Add `approvalFloorFromLoaded` — assembles `ApprovalFloorInput` from loaded registration data so both renderers share one derivation. |
| `src/lib/i18n/labels.ts` | UI-term SSOT | Add incomplete-notice heading, per-requirement labels, the rewritten anti-phishing line, the next-step CTA label. |
| `src/components/features/register/registration-pending-notice.tsx` | The applicant's status card | Becomes floor-aware: incomplete variant vs today's submitted variant. |
| `src/components/features/register/staff-register-workspace.tsx` | Server workspace | Computes the floor once; passes it to the notice. |
| `src/components/features/register/staff-registration-form.tsx` | The form | Un-gate the outstanding-items hint; move documents + consent above the CTA; next-step CTA label + scroll. |
| `tests/unit/registration-pending-notice.test.tsx` | Existing notice test | **Will break by design** — update deliberately (see Task 2). |
| `tests/unit/register-floor.test.ts` | Existing floor test | Extend for the new helper. |
| `tests/unit/registration-completion-order.test.tsx` | New | DOM-order + CTA pins. |

---

### Task 1: derive the floor input in one place

**Files:**
- Modify: `src/lib/register/registration-floor.ts`
- Test: `tests/unit/register-floor.test.ts`

**Interfaces:**
- Consumes: existing `registrationApprovalFloor`, `ApprovalFloorInput`, `ApprovalFloor`.
- Produces: `approvalFloorFromLoaded(input: LoadedRegistrationFloorInput): ApprovalFloor`
  where
  ```ts
  export interface LoadedRegistrationFloorInput {
    fullName: string | null;
    docUrls: Partial<Record<"id_card" | "book_bank" | "profile_photo", string>>;
    consentedAt: string | null;
    bankSaved: boolean;
    bankExempt: boolean;
  }
  ```

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/register-floor.test.ts`:

```ts
describe("approvalFloorFromLoaded", () => {
  const base = {
    fullName: "เหิน เมืองงาม",
    docUrls: {},
    consentedAt: null,
    bankSaved: false,
    bankExempt: false,
  };

  it("reports id_card and consent outstanding for a bank-exempt firm member", () => {
    const floor = approvalFloorFromLoaded({ ...base, bankExempt: true });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["id_card", "consent"]);
  });

  it("never asks a bank-exempt member for bank items", () => {
    const floor = approvalFloorFromLoaded({ ...base, bankExempt: true });
    expect(floor.missing).not.toContain("book_bank");
    expect(floor.missing).not.toContain("bank_fields");
  });

  it("is met once a firm member has an id_card and consent", () => {
    const floor = approvalFloorFromLoaded({
      ...base,
      bankExempt: true,
      docUrls: { id_card: "https://example.test/a.jpg" },
      consentedAt: "2026-07-22T13:09:53Z",
    });
    expect(floor).toEqual({ met: true, missing: [] });
  });

  it("keeps both bank requirements for a PRC applicant", () => {
    const floor = approvalFloorFromLoaded({
      ...base,
      docUrls: { id_card: "https://example.test/a.jpg" },
      consentedAt: "2026-07-22T13:09:53Z",
    });
    expect(floor.missing).toEqual(["book_bank", "bank_fields"]);
  });
});
```

Add `approvalFloorFromLoaded` to the existing import at the top of the file.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm test tests/unit/register-floor.test.ts`
Expected: FAIL — `approvalFloorFromLoaded is not a function` (or a TS resolution error).

- [ ] **Step 3: Implement**

Append to `src/lib/register/registration-floor.ts`:

```ts
/** Spec 343 U1 — one derivation of the floor input from loaded registration data,
 *  so the pending notice (server) and the form (client) can never disagree about
 *  what is still outstanding. Pure. */
export interface LoadedRegistrationFloorInput {
  fullName: string | null;
  docUrls: Partial<Record<"id_card" | "book_bank" | "profile_photo", string>>;
  consentedAt: string | null;
  bankSaved: boolean;
  bankExempt: boolean;
}

export function approvalFloorFromLoaded(input: LoadedRegistrationFloorInput): ApprovalFloor {
  return registrationApprovalFloor({
    fullName: input.fullName,
    hasIdCard: Boolean(input.docUrls.id_card),
    hasBookBank: Boolean(input.docUrls.book_bank),
    hasBankFields: input.bankSaved,
    hasConsent: Boolean(input.consentedAt),
    bankExempt: input.bankExempt,
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test tests/unit/register-floor.test.ts`
Expected: PASS, all four new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/register/registration-floor.ts tests/unit/register-floor.test.ts
git commit -m "feat(register): derive the approval floor from loaded data in one place (spec 343 U1)"
```

---

### Task 2: the pending notice stops claiming success

**Files:**
- Modify: `src/lib/i18n/labels.ts`
- Modify: `src/components/features/register/registration-pending-notice.tsx`
- Modify: `src/components/features/register/staff-register-workspace.tsx:251`
- Test: `tests/unit/registration-pending-notice.test.tsx` (existing — updated deliberately)

**Interfaces:**
- Consumes: `ApprovalFloor` and `approvalFloorFromLoaded` from Task 1.
- Produces: `RegistrationPendingNoticeProps = { employeeId: string; floor: ApprovalFloor }`.
  `floor` is **required, not defaulted** — a default would let the existing test
  keep passing while the rendered behaviour changed underneath it.

⚠ **Expected RED:** the three existing cases in
`registration-pending-notice.test.tsx` render without `floor` and assert today's
heading unconditionally. Typecheck must fail and those cases must go red. **If
they stay green, stop and find out why** — that means the prop was defaulted or
the test is not reaching the component.

- [ ] **Step 1: Write the failing test**

Replace the body of `tests/unit/registration-pending-notice.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegistrationPendingNotice } from "@/components/features/register/registration-pending-notice";

import type { ApprovalFloor } from "@/lib/register/registration-floor";

// Plain ApprovalFloor values — no `as const`, whose readonly tuple would not be
// assignable to ApprovalFloor.missing (a mutable ApprovalRequirement[]).
const met: ApprovalFloor = { met: true, missing: [] };

describe("RegistrationPendingNotice — floor met", () => {
  it("tells the applicant they're done and don't need to share anything further", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={met} />);
    expect(screen.getByText("ส่งใบสมัครแล้ว รอการอนุมัติ")).toBeInTheDocument();
  });

  it("stays role-neutral so an office applicant sees no 'ช่าง' wording (spec 286)", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={met} />);
    expect(screen.queryByText(/ช่าง/)).not.toBeInTheDocument();
  });

  it("shows the employee id as plain selectable reference text", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={met} />);
    expect(screen.getByText("รหัสพนักงานของคุณ: PRC-26-0042 — เก็บไว้อ้างอิง")).toBeInTheDocument();
  });
});

describe("RegistrationPendingNotice — floor NOT met (spec 343 D1)", () => {
  const outstanding: ApprovalFloor = { met: false, missing: ["id_card", "consent"] };

  it("does NOT claim the application was submitted", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.queryByText("ส่งใบสมัครแล้ว รอการอนุมัติ")).not.toBeInTheDocument();
  });

  it("says the application is incomplete", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.getByText("ยังส่งไม่ครบ")).toBeInTheDocument();
  });

  it("names every outstanding item, each linking to its control", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.getByRole("link", { name: "อัปโหลดบัตรประชาชน" })).toHaveAttribute(
      "href",
      "#reg-documents",
    );
    expect(screen.getByRole("link", { name: "ให้ความยินยอม (PDPA)" })).toHaveAttribute(
      "href",
      "#reg-consent",
    );
  });

  it("never tells an incomplete applicant that no card is needed", () => {
    render(<RegistrationPendingNotice employeeId="PRC-26-0042" floor={outstanding} />);
    expect(screen.queryByText(/ไม่ต้องส่งบัตรให้ใครเพิ่ม/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm test tests/unit/registration-pending-notice.test.tsx`
Expected: FAIL — `ยังส่งไม่ครบ` not found; the "does NOT claim" case fails because
the heading renders unconditionally today.

- [ ] **Step 3: Add the labels**

In `src/lib/i18n/labels.ts`, beside the existing
`REGISTRATION_PENDING_NOTICE_*` constants (around line 927):

```ts
// Spec 343 U1 — the pending notice is floor-aware. Below the approval floor the
// card must NOT claim submission: 4 of 4 live applicants stopped at the profile
// step because the old copy told them they were done and waiting.
export const REGISTRATION_INCOMPLETE_NOTICE_HEADING = "ยังส่งไม่ครบ";
export const REGISTRATION_INCOMPLETE_NOTICE_BODY =
  "ใบสมัครของคุณยังส่งไม่สมบูรณ์ ทำอีก 2 อย่างนี้ให้ครบ แล้วทีมงานจะพิจารณาให้";
/** Rewritten from "ไม่ต้องส่งบัตรให้ใครเพิ่ม" (spec 343 D1): the old line was
 *  anti-phishing advice that read as "no ID card is needed". */
export const REGISTRATION_ANTI_PHISHING_LINE = "อย่าส่งบัตรให้คนอื่น — อัปโหลดในแอปนี้เท่านั้น";
export const APPROVAL_REQUIREMENT_LABEL: Record<ApprovalRequirement, string> = {
  full_name: "กรอกชื่อ-นามสกุล",
  id_card: "อัปโหลดบัตรประชาชน",
  book_bank: "อัปโหลดสมุดบัญชีธนาคาร",
  bank_fields: "กรอกเลขบัญชีธนาคาร",
  consent: "ให้ความยินยอม (PDPA)",
};
/** Anchor ids the incomplete checklist jumps to (spec 343 U1). */
export const REGISTER_DOCUMENTS_ANCHOR = "reg-documents";
export const REGISTER_CONSENT_ANCHOR = "reg-consent";
```

Import `ApprovalRequirement` as a type at the top of `labels.ts`:
`import type { ApprovalRequirement } from "@/lib/register/registration-floor";`

⚠ `REGISTRATION_INCOMPLETE_NOTICE_BODY` hardcodes "2 อย่าง". A bank-exempt member
owes exactly id_card + consent, which is the live case for all four stuck
applicants — but a PRC applicant can owe four. Use this instead, and delete the
`_BODY` constant above:

```ts
export function registrationIncompleteBody(count: number): string {
  return `ใบสมัครของคุณยังส่งไม่สมบูรณ์ เหลืออีก ${count} อย่าง แล้วทีมงานจะพิจารณาให้`;
}
```

- [ ] **Step 4: Implement the notice**

Replace `src/components/features/register/registration-pending-notice.tsx`:

```tsx
// Spec 264 follow-up (Handoff Unit A) — the applicant waiting-card.
// Spec 343 U1: it is now floor-aware. It previously rendered
// "ส่งใบสมัครแล้ว รอการอนุมัติ" the instant the profile saved, while the id_card
// and PDPA consent were still outstanding — all 4 live pending applicants
// stopped there. Below the floor it names what is left and links to it; only at
// the floor does it claim submission.

import Link from "next/link";
import { CARD } from "@/lib/ui/classes";
import type { ApprovalFloor } from "@/lib/register/registration-floor";
import {
  REGISTRATION_PENDING_NOTICE_HEADING,
  REGISTRATION_PENDING_NOTICE_BODY,
  REGISTRATION_INCOMPLETE_NOTICE_HEADING,
  REGISTRATION_ANTI_PHISHING_LINE,
  APPROVAL_REQUIREMENT_LABEL,
  REGISTER_DOCUMENTS_ANCHOR,
  REGISTER_CONSENT_ANCHOR,
  registrationIncompleteBody,
  registrationPendingEmployeeIdLine,
} from "@/lib/i18n/labels";

export interface RegistrationPendingNoticeProps {
  employeeId: string;
  /** Required, never defaulted — a default would let a caller silently render
   *  the "submitted" copy over an incomplete application. */
  floor: ApprovalFloor;
}

const ANCHOR_FOR = {
  full_name: null,
  id_card: REGISTER_DOCUMENTS_ANCHOR,
  book_bank: REGISTER_DOCUMENTS_ANCHOR,
  bank_fields: null,
  consent: REGISTER_CONSENT_ANCHOR,
} as const;

export function RegistrationPendingNotice({ employeeId, floor }: RegistrationPendingNoticeProps) {
  return (
    <div className={`${CARD} border-attn-edge bg-attn-soft`}>
      <p className="text-attn-ink text-sm font-semibold">
        {floor.met ? REGISTRATION_PENDING_NOTICE_HEADING : REGISTRATION_INCOMPLETE_NOTICE_HEADING}
      </p>
      <p className="text-attn-ink mt-1 text-sm">
        {floor.met
          ? REGISTRATION_PENDING_NOTICE_BODY
          : registrationIncompleteBody(floor.missing.length)}
      </p>
      {floor.met ? null : (
        <ul className="mt-2 flex flex-col gap-1">
          {floor.missing.map((requirement) => {
            const anchor = ANCHOR_FOR[requirement];
            const label = APPROVAL_REQUIREMENT_LABEL[requirement];
            return (
              <li key={requirement} className="text-attn-ink text-sm">
                {anchor ? (
                  <Link href={`#${anchor}`} className="min-h-11 font-semibold underline">
                    {label}
                  </Link>
                ) : (
                  <span className="font-semibold">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {floor.met ? null : (
        <p className="text-attn-ink mt-2 text-xs">{REGISTRATION_ANTI_PHISHING_LINE}</p>
      )}
      <p className="text-attn-ink mt-2 text-sm select-all">
        {registrationPendingEmployeeIdLine(employeeId)}
      </p>
    </div>
  );
}
```

⚠ `REGISTRATION_PENDING_NOTICE_BODY` still contains `ไม่ต้องส่งบัตรให้ใครเพิ่ม`.
That is correct for the **met** branch — at that point the card genuinely is
uploaded — and the existing role-neutrality test still covers it. Leave it.

- [ ] **Step 5: Wire the workspace**

In `src/components/features/register/staff-register-workspace.tsx`, inside
`RegistrationWorkspace` after the existing `Promise.all` (around line 227):

```tsx
const floor = approvalFloorFromLoaded({
  fullName: registration.full_name,
  docUrls: urls,
  consentedAt: consent?.consentedAt ?? null,
  bankSaved:
    validateRegistrationBank({
      bankName: bank?.bankName ?? "",
      accountNumber: bank?.accountNumber ?? "",
      accountName: bank?.accountName ?? "",
    }) === null,
  bankExempt: Boolean(registration.invited_contractor_id),
});
```

Then at line 251, pass it: `<RegistrationPendingNotice employeeId={registration.employee_id} floor={floor} />`.

Add the imports — both paths verified at HEAD:

```tsx
import { approvalFloorFromLoaded } from "@/lib/register/registration-floor";
import { validateRegistrationBank } from "@/lib/register/registration-bank";
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm test tests/unit/registration-pending-notice.test.tsx && pnpm typecheck`
Expected: PASS, and typecheck clean (every call site now passes `floor`).

- [ ] **Step 7: Mutation-check**

Commit first (next step is destructive to uncommitted work), then by hand change
the notice's heading ternary to always render
`REGISTRATION_PENDING_NOTICE_HEADING`. Re-run the test.
Expected: the "does NOT claim the application was submitted" case goes RED.
Restore with `git checkout -- src/components/features/register/registration-pending-notice.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/i18n/labels.ts src/components/features/register/registration-pending-notice.tsx src/components/features/register/staff-register-workspace.tsx tests/unit/registration-pending-notice.test.tsx
git commit -m "fix(register): pending notice stops claiming submission below the approval floor (spec 343 U1)"
```

---

### Task 3: the outstanding-items hint stops self-suppressing

**Files:**
- Modify: `src/components/features/register/staff-registration-form.tsx:653`
- Test: `tests/unit/staff-registration-form-subcon.test.tsx`

**Interfaces:** none new — a one-conjunct change plus its pin.

- [ ] **Step 1: Write the failing test**

The existing helper in that file is `renderExisting(bankExempt: boolean)`, which
hardcodes `docUrls={{}}` and `consentedAt={null}` — it cannot express this case.
Add a parameterised sibling **next to it** (leave `renderExisting` and its three
existing callers untouched):

```tsx
function renderExistingWith(props: {
  bankExempt: boolean;
  docUrls?: Record<string, string>;
  consentedAt?: string | null;
}) {
  return render(
    <StaffRegistrationForm
      registrationExists
      uid="00000000-0000-4000-8000-000000000328"
      docUrls={props.docUrls ?? {}}
      consentedAt={props.consentedAt ?? null}
      initial={INITIAL}
      bankExempt={props.bankExempt}
    />,
  );
}
```

Then append the case:

```tsx
it("still names the outstanding id_card after consent is given (spec 343 D3)", () => {
  renderExistingWith({ bankExempt: true, consentedAt: "2026-07-22T13:09:53Z" });
  expect(
    screen.getByText(
      "ต้องกรอกชื่อ-นามสกุล อัปโหลดบัตรประชาชน และให้ความยินยอมนี้ ก่อนที่จะได้รับการอนุมัติ",
    ),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tests/unit/staff-registration-form-subcon.test.tsx`
Expected: FAIL — the hint is absent, because `{!floorMet && !consentedAt}`
suppresses it exactly when consent exists.

- [ ] **Step 3: Implement**

In `staff-registration-form.tsx`, change the guard at line 653 from
`{!floorMet && !consentedAt ? (` to `{!floorMet ? (`.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test tests/unit/staff-registration-form-subcon.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit, then mutation-check**

```bash
git add src/components/features/register/staff-registration-form.tsx tests/unit/staff-registration-form-subcon.test.tsx
git commit -m "fix(register): outstanding-items hint survives a given consent (spec 343 U1/D3)"
```

Then restore `&& !consentedAt` by hand, re-run, confirm RED, and
`git checkout -- src/components/features/register/staff-registration-form.tsx`.

---

### Task 4: required steps move above the primary CTA

**Files:**
- Modify: `src/components/features/register/staff-registration-form.tsx:300-330`
- Modify: `src/lib/i18n/labels.ts`
- Test: `tests/unit/registration-completion-order.test.tsx` (create)

**Interfaces:**
- Consumes: `REGISTER_DOCUMENTS_ANCHOR`, `REGISTER_CONSENT_ANCHOR` from Task 2.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/registration-completion-order.test.tsx`. The form pulls in
`next/navigation`, the toast, the server actions and the browser client, so the
mock preamble is **required** — copy it verbatim from
`staff-registration-form-subcon.test.tsx:10-31`, which is the working reference:

```tsx
import { describe, it, expect, vi } from "vitest";
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
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
}));

import { StaffRegistrationForm } from "@/components/features/register/staff-registration-form";

const INITIAL = {
  fullName: "สมาชิก ทีมอวย",
  phone: "0810000328",
  dob: "",
  emergencyName: "",
  emergencyRelation: "",
  emergencyPhone: "",
  declaredRoleHint: "",
  bankName: "",
  accountNumber: "",
  accountName: "",
};

function renderForm(props: { docUrls?: Record<string, string>; consentedAt?: string | null }) {
  return render(
    <StaffRegistrationForm
      registrationExists
      uid="00000000-0000-4000-8000-000000000328"
      docUrls={props.docUrls ?? {}}
      consentedAt={props.consentedAt ?? null}
      initial={INITIAL}
      bankExempt
    />,
  );
}
```

Then the three cases:

```tsx
it("renders the document and consent controls BEFORE the primary button", () => {
  const { container } = renderForm({});
  const nodes = Array.from(
    container.querySelectorAll("#reg-documents, #reg-consent, button[data-testid='reg-primary']"),
  );
  const ids = nodes.map((n) => n.id || n.getAttribute("data-testid"));
  expect(ids).toEqual(["reg-documents", "reg-consent", "reg-primary"]);
});

it("names the next step on the CTA while the floor is unmet", () => {
  renderForm({});
  expect(screen.getByTestId("reg-primary")).toHaveTextContent("บันทึกและไปขั้นต่อไป");
});

it("reverts to a plain save once the floor is met", () => {
  renderForm({
    docUrls: { id_card: "https://example.test/a.jpg" },
    consentedAt: "2026-07-22T13:09:53Z",
  });
  expect(screen.getByTestId("reg-primary")).toHaveTextContent("บันทึก");
  expect(screen.getByTestId("reg-primary")).not.toHaveTextContent("ไปขั้นต่อไป");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tests/unit/registration-completion-order.test.tsx`
Expected: FAIL — order is `["reg-primary", "reg-documents", "reg-consent"]`, and
the CTA reads `บันทึก`.

- [ ] **Step 3: Add the CTA label**

In `labels.ts`, beside the Task 2 additions:

```ts
export const REGISTER_SAVE_AND_NEXT_LABEL = "บันทึกและไปขั้นต่อไป";
```

- [ ] **Step 4: Implement**

In `staff-registration-form.tsx`:

1. Move the whole `{registrationExists && uid ? (<>…</>) : null}` block (currently
   after the button, line 306) to **directly before** the `<button>` at line 300.
2. Give the blocks their anchors: wrap `<StaffDocuments …/>` in
   `<div id={REGISTER_DOCUMENTS_ANCHOR}>` and `<StaffConsentCheckbox …/>` in
   `<div id={REGISTER_CONSENT_ANCHOR}>`.
3. Add `data-testid="reg-primary"` to the button.
4. Label and scroll:

```tsx
{pending ? "กำลังบันทึก…" : registrationExists ? (floor.met ? "บันทึก" : REGISTER_SAVE_AND_NEXT_LABEL) : "เริ่มสมัคร"}
```

and in `submit()`, after `toast.success("บันทึกแล้ว"); router.refresh();`:

```tsx
if (registrationExists && !floor.met) {
  const first = floor.missing.includes("consent") && floor.missing.length === 1
    ? REGISTER_CONSENT_ANCHOR
    : REGISTER_DOCUMENTS_ANCHOR;
  document.getElementById(first)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
```

The label promises a next step, so the scroll must actually happen — a label that
named a step without moving the user there is the same defect class as D1.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm test tests/unit/registration-completion-order.test.tsx`
Expected: PASS, all three cases.

- [ ] **Step 6: Full suite + lint + typecheck**

Run: `pnpm lint && pnpm typecheck && pnpm test 2>&1 | grep -E "✕|×|FAIL|Failed Tests|Tests "`
Expected: zero failures. Pipe through the grep so any failure arrives with its
**name**, not just a count — a nameless count forces a re-run.

- [ ] **Step 7: Commit, then mutation-check**

```bash
git add src/lib/i18n/labels.ts src/components/features/register/staff-registration-form.tsx tests/unit/registration-completion-order.test.tsx
git commit -m "fix(register): documents and consent render above the primary CTA (spec 343 U1/D2)"
```

Then move the block back below the button by hand, re-run, confirm the order test
goes RED, and restore with `git checkout --`.

---

## Verification before shipping

Unit gate 4 — tests green is not "works":

- [ ] Drive the real flow **logged out**. A new applicant is always logged out at
      first scan, and that is the leg #677 proved is easy to skip: a visitor
      created already-logged-in never exercises it. Scan a firm QR from
      `/team` → LINE login → fill the name → save, and confirm the card reads
      `ยังส่งไม่ครบ` with both items listed, that tapping an item lands on its
      control, and that the CTA scrolled you there. Zero console errors.
- [ ] If the browser refuses to drive (React answering no clicks on this box is a
      documented wedge — specs 335/337 U5), substitute an RSC-flight/SSR probe of
      the rendered markup plus the RTL pins, and **say so explicitly** in the PR
      rather than claiming a browser verify.
- [ ] Fresh-eyes review of the full diff; address every finding against the code
      before agreeing with it.
- [ ] `scripts/ship-pr.sh` — never assert "merges clean" without it.

## Out of scope for U1

U2 (เตรียมตัว prep screen) and U3 (poster + LINE prepare line) are separate units
in the same spec. Do not start them here. Anything else noticed along the way
goes to `docs/progress-tracker.md` open questions, not into this diff.
