# Spec 355 — structured reject-evidence reasons — Implementation Plan

> **For agentic workers:** load the `ship-unit` skill for EVERY task — each task is one PR through the gate. U1 is a **schema** unit (single schema lane; additive migration → operator-merged). U2/U3 are code-only and depend on U1 being merged + `db:types` regenerated. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make reject-evidence carry a required structured reason (incomplete / mismatch / premature), each driving the SA's correct next-action, so the wrong-WP "mismatch" case gets "remove-and-reshoot" instead of a generic "re-shoot" — and becomes measurable.

**Architecture:** A new `approval_revision_reason` enum + `approvals.revision_reason` column; `decide_work_package` gains `p_revision_reason` and validates it (required iff needs_revision). The PM form shows reason chips; the reason is single-sourced (`APPROVAL_REVISION_REASON_LABEL`) and drives a per-reason guidance/CTA (`REVISION_REASON_GUIDANCE`) on the spec-353 SA attention card + the SA worklist chip.

**Tech Stack:** Postgres/Supabase (enum + column + DEFINER RPC + pgTAP), Next.js 16 RSC, TypeScript strict, Vitest + RTL. Thai UI copy.

## Global Constraints

- **TDD, RED first.** First commit per unit is the failing test; state "Writing failing test first."
- **Schema single-lane + DB-ahead.** The live schema head is already `20260813075848` (an in-flight lane's migration not yet in origin/main). **Do NOT reuse 075848.** Claim the next free number from `../LANES.md` schema-lane STATUS at build time — expected `075849`, but re-check (`ls supabase/migrations` + the live `schema_migrations` head + LANES).
- **Source the RPC from LIVE, never a migration file.** U1's DROP+CREATE starts from `pg_get_functiondef('public.decide_work_package'::regproc)` and changes ONLY the signature + validation + insert. Everything else — the role gate, the `for update` lock, the `rejected`→rework + `rework_round++`, and the `rejected`-branch `audit_log` `wp_reopened_for_defect` write (comment as reason, spec 337 F3) — is carried forward verbatim.
- **New enum trips guards deliberately.** The i18n enum-completeness harness (`tests/unit/i18n-labels.test.ts`) uses a HARDCODED `MAPS` array — register the new label map there. `Constants.public.Enums.approval_revision_reason` only exists after U1's migration + `pnpm db:types`, so U2's label test depends on U1 merged.
- **Enum codes English snake_case** (`incomplete`/`mismatch`/`premature`); labels Thai in `labels.ts`.
- **`src/lib/i18n/labels.ts` is a shared SSOT** — lane `355reason`; serialize if another lane appears.
- Assertions pin absence + mutation-check (doctrine); pgTAP RED-first.

## File Structure

| File                                                                    | Responsibility                                                           | Task |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---- |
| `supabase/migrations/<0758xx>_spec355_revision_reason.sql`              | enum + `approvals.revision_reason` + `decide_work_package` DROP+CREATE   | U1   |
| `supabase/tests/database/355-revision-reason.sql`                       | pgTAP: validation arms + reason persists                                 | U1   |
| `src/lib/approvals/predicates.ts`                                       | `commentRequiredFor` (→ rejected-only) + new `revisionReasonRequiredFor` | U2   |
| `src/app/review/work-packages/[workPackageId]/record-decision-form.tsx` | reason chips when needs_revision; `canSubmit` requires a reason          | U2   |
| `src/app/review/work-packages/[workPackageId]/actions.ts`               | `recordDecision` threads `revisionReason` → `p_revision_reason`          | U2   |
| `src/lib/i18n/labels.ts`                                                | `APPROVAL_REVISION_REASON_LABEL` + `REVISION_REASON_GUIDANCE` SSOT       | U2   |
| `tests/unit/i18n-labels.test.ts`                                        | register the new label map in `MAPS`                                     | U2   |
| `src/lib/work-packages/load-detail.ts`                                  | approvals select += `revision_reason`; carry on the decision row         | U3   |
| `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx`   | attention card: per-reason guidance + CTA (mismatch → remove+reshoot)    | U3   |
| `src/components/features/sa/action-section.tsx`                         | the ต้องแก้ไข chip shows the reason                                      | U3   |

---

## Task 1: Schema — enum + column + RPC · additive migration (operator-merged)

**Files:** Create the migration + pgTAP file (numbers per Global Constraints).

- [ ] **Step 1 — claim the schema lane + pick the number.** Read `../LANES.md` whole; confirm the schema lane is free and take the next number after the live head (`ls supabase/migrations | tail`; `pnpm exec supabase db query --linked "select version from supabase_migrations.schema_migrations order by version desc limit 3"`). Claim it in LANES.

- [ ] **Step 2 — write the pgTAP RED first.** `supabase/tests/database/355-revision-reason.sql` (standard `begin; select plan(N); … finish(); rollback;`). Assert, as an authenticated PM:
  - the enum `approval_revision_reason` exists with exactly {incomplete, mismatch, premature} (`has_type`, `results_eq` on `enum_range`);
  - `approvals.revision_reason` exists and is nullable;
  - `decide_work_package(p_wp, 'needs_revision', null, null)` raises `22023` (reason required);
  - `decide_work_package(p_wp, 'needs_revision', null, 'mismatch')` succeeds and the `approvals` row has `revision_reason='mismatch'` and `decision='needs_revision'`;
  - `decide_work_package(p_wp, 'rejected', null, 'mismatch')` raises `22023` (reason not allowed on rejected) AND `decide_work_package(p_wp, 'rejected', null, null)` raises `22023` (comment still required for rejected);
  - `decide_work_package(p_wp, 'approved', null, null)` succeeds with `revision_reason` null.

  Run `pnpm db:test` → the file is RED (objects don't exist yet).

- [ ] **Step 3 — write the migration.** Source the live body first (`pnpm exec supabase db query --linked "select pg_get_functiondef('public.decide_work_package'::regproc)"`), then:

```sql
-- Spec 355: structured reject-evidence reasons.
create type public.approval_revision_reason as enum ('incomplete', 'mismatch', 'premature');

alter table public.approvals
  add column revision_reason public.approval_revision_reason;  -- nullable; historical rows stay null

comment on column public.approvals.revision_reason is
  'Spec 355: why a needs_revision decision sent the photos back (incomplete/mismatch/premature). Null for approved/rejected.';

-- DROP+CREATE decide_work_package from the LIVE body, changing ONLY:
--   (a) signature gains a trailing p_revision_reason,
--   (b) the blanket "comment required for non-approved" check becomes the three
--       arms below,
--   (c) the approvals INSERT carries revision_reason.
-- Everything else (role gate, `for update`, needs_revision no-op, rejected→rework
-- + rework_round++ + the audit_log wp_reopened_for_defect write, approved→complete)
-- is preserved verbatim.
create or replace function public.decide_work_package(
  p_wp uuid,
  p_decision approval_decision,
  p_comment text default null,
  p_revision_reason approval_revision_reason default null
) returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare
  -- …carry the live declarations verbatim…
begin
  -- …carry the live role gate + can_see_wp check verbatim…

  -- Spec 355 — replace the single "comment required for non-approved" check:
  if p_decision = 'needs_revision' and p_revision_reason is null then
    raise exception 'decide_work_package: revision reason required' using errcode = '22023';
  end if;
  if p_decision <> 'needs_revision' and p_revision_reason is not null then
    raise exception 'decide_work_package: revision reason only for needs_revision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_comment is null then
    raise exception 'decide_work_package: comment required for this decision' using errcode = '22023';
  end if;

  -- …carry the `select status … for update` + not-found + not-pending checks verbatim…

  insert into public.approvals (work_package_id, decision, comment, decided_by, revision_reason)
  values (p_wp, p_decision, v_comment, v_uid, p_revision_reason);

  -- …carry the approved / rejected(+audit) / needs_revision branches verbatim…
  return v_new::text;
end;
$function$;
```

Regrant EXECUTE exactly as the live function has it (check `\df+`; the repo pattern is `revoke all … from public, anon` then `grant execute … to authenticated`). Preserve the existing grants — a DROP+CREATE resets them.

- [ ] **Step 4 — push + types + test.** `pnpm db:push` → `pnpm db:types` → `pnpm db:test`. The 355 pgTAP file goes GREEN; zero collateral (only the tolerated 221/200 pre-existing reds). `git status` after `db:types` (it rewrites `database.types.ts`).

- [ ] **Step 5 — real-flow + ship.** Execute the RPC live on a throwaway pending_approval WP for each arm (reason required / reason-on-rejected refused / needs_revision persists the reason), show the output, then reverse. Fresh-eyes review; ship via `ship-pr.sh`. **Migration → danger-path guard holds → operator-merged (or standing-grant admin-merge on green per the additive-migration grant).**

---

## Task 2: PM form — reason chips · code-only (depends on U1 merged + db:types)

**Files:** `predicates.ts`, `record-decision-form.tsx`, `actions.ts`, `labels.ts`, `i18n-labels.test.ts`. **Interfaces produced:** `APPROVAL_REVISION_REASON_LABEL: Record<approval_revision_reason,string>`, `revisionReasonRequiredFor(decision): boolean`, `RecordDecisionInput.revisionReason?`.

- [ ] **Step 1 — failing test (predicates + labels).** In a new `tests/unit/revision-reason-predicates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { commentRequiredFor, revisionReasonRequiredFor } from "@/lib/approvals/predicates";
import { APPROVAL_REVISION_REASON_LABEL } from "@/lib/i18n/labels";

describe("spec 355 — comment vs reason requirement", () => {
  it("comment is required only for reject-work (rejected), not needs_revision", () => {
    expect(commentRequiredFor("rejected")).toBe(true);
    expect(commentRequiredFor("needs_revision")).toBe(false);
    expect(commentRequiredFor("approved")).toBe(false);
  });
  it("a structured reason is required only for reject-evidence (needs_revision)", () => {
    expect(revisionReasonRequiredFor("needs_revision")).toBe(true);
    expect(revisionReasonRequiredFor("rejected")).toBe(false);
    expect(revisionReasonRequiredFor("approved")).toBe(false);
  });
  it("labels the three reasons", () => {
    expect(APPROVAL_REVISION_REASON_LABEL.incomplete).toBe("รูปไม่ครบ");
    expect(APPROVAL_REVISION_REASON_LABEL.mismatch).toBe("รูปไม่ตรงกับงาน");
    expect(APPROVAL_REVISION_REASON_LABEL.premature).toBe("งานยังไม่เสร็จ");
  });
});
```

Run → RED (`revisionReasonRequiredFor` / label undefined).

- [ ] **Step 2 — implement predicates + labels.**
  - `predicates.ts`: change `commentRequiredFor` from `decision !== "approved"` to `decision === "rejected"`; add `export function revisionReasonRequiredFor(d: ApprovalDecision): boolean { return d === "needs_revision"; }`.
  - `labels.ts`:

```ts
export const APPROVAL_REVISION_REASON_LABEL: Record<Enums["approval_revision_reason"], string> = {
  incomplete: "รูปไม่ครบ",
  mismatch: "รูปไม่ตรงกับงาน",
  premature: "งานยังไม่เสร็จ",
};
```

- `tests/unit/i18n-labels.test.ts`: add to `MAPS`:
  `["approval_revision_reason", Constants.public.Enums.approval_revision_reason, APPROVAL_REVISION_REASON_LABEL],` (import the map).

Run → GREEN. Mutation-check: revert `commentRequiredFor` to `!== "approved"`, confirm the needs_revision case reds, restore.

- [ ] **Step 3 — failing test (form).** In `tests/unit/record-decision-form.test.tsx` add: reason chips render only when needs_revision is selected; submit is disabled until a reason is picked; the comment is optional for needs_revision (no `*`); the action is called with `revisionReason`. (RTL — select the needs_revision radio, assert the three chips `getByText(APPROVAL_REVISION_REASON_LABEL.*)`, assert submit disabled, click a chip, assert enabled.)

- [ ] **Step 4 — implement the form.** In `record-decision-form.tsx`:
  - add `const [revisionReason, setRevisionReason] = useState<ApprovalRevisionReason | null>(null)`; reset it when the decision changes off needs_revision.
  - when `decision === "needs_revision"`, render the three reason chips (radios/segmented, `APPROVAL_REVISION_REASON_LABEL`) between the decision radios and the comment.
  - `needsComment` now = `commentRequiredFor(decision)` (rejected only) — the comment field's `*`/`required`/placeholder follow it.
  - `canSubmit = decision !== null && isCommentValid(decision, comment||null) && (!revisionReasonRequiredFor(decision) || revisionReason !== null) && !submitting`.
  - `handleSubmit` → `recordDecision({ workPackageId, decision, comment: …, revisionReason: decision === "needs_revision" ? revisionReason : null })`.

- [ ] **Step 5 — implement the action.** `actions.ts`: `RecordDecisionInput` gains `revisionReason?: ApprovalRevisionReason | null`; validate (reason required iff needs_revision, mirror the predicate) with a Thai error; pass `p_revision_reason` in the `decide_work_package` rpc call when non-null (same conditional-spread idiom as `p_comment`). Keep the `isCommentValid` pre-check but note comment is now only required for rejected.

- [ ] **Step 6 — GREEN + full verify + ship.** `pnpm lint && pnpm typecheck && pnpm test` green. Real-flow: dev-preview as a PM on `/review`, pick ให้แก้ไข → the three chips appear, submit disabled until one is chosen, comment optional; the `approvals` row lands with the reason (verify live). Fresh-eyes + ship (code-only → auto-merge; `labels.ts` shared-SSOT — confirm sole lane).

---

## Task 3: SA side — tailored next-action · code-only (depends on U1 + U2)

**Files:** `load-detail.ts`, `page.tsx`, `action-section.tsx`, `labels.ts` (guidance SSOT). **Interface produced:** `REVISION_REASON_GUIDANCE: Record<approval_revision_reason, { cta: string; guidance: string }>`.

- [ ] **Step 1 — failing test (guidance SSOT + card).** New `tests/unit/revision-reason-guidance.test.tsx`: assert `REVISION_REASON_GUIDANCE.mismatch.cta` names remove-and-reshoot (contains "ลบ" + "ถ่ายใหม่") and is DISTINCT from `incomplete`/`premature`; then render the WP-detail attention card (or a small extracted `RevisionReasonNote` component) with a mismatch decision and assert it shows the mismatch guidance, not the generic 353 CTA. (If the card is hard to isolate in RSC, extract the reason→guidance rendering into a tiny presentational component `RevisionReasonNote` and RTL-test that; the page renders it.)

- [ ] **Step 2 — implement the guidance SSOT.** `labels.ts`:

```ts
export const REVISION_REASON_GUIDANCE: Record<
  Enums["approval_revision_reason"],
  { cta: string; guidance: string }
> = {
  incomplete: {
    cta: "เพิ่มรูปให้ครบ",
    guidance: "เพิ่มรูปช่วงที่ผู้จัดการแจ้ง แล้วส่งตรวจอีกครั้ง",
  },
  mismatch: {
    cta: "ลบรูปที่ไม่ตรง แล้วถ่ายใหม่",
    guidance: "รูปที่ส่งไม่ตรงกับงานนี้ — ลบรูปที่ผิดออก แล้วถ่ายใหม่ให้ตรงกับงาน",
  },
  premature: {
    cta: "ทำงานให้เสร็จก่อน",
    guidance: "งานยังไม่เสร็จ — ทำให้เสร็จ แล้วค่อยถ่ายรูปตอนเสร็จและส่งตรวจ",
  },
};
```

- [ ] **Step 3 — thread the reason to the SA.** `load-detail.ts`: add `revision_reason` to the approvals `.select(...)` and carry it on the decision row type. `page.tsx`: the attention card (`attention.decision === "needs_revision"`) reads `attention.revision_reason`; when present, render the `REVISION_REASON_GUIDANCE[reason]` guidance line + the reason label chip, and the CTA becomes `REVISION_REASON_GUIDANCE[reason].cta` (replacing the 353 phase-named CTA for the reasoned case; fall back to the 353 CTA when the reason is null — historical rows). For **mismatch**, the CTA links to `#wp-photos` where the spec-291 delete is available (the window is already open on a needs_revision WP).

- [ ] **Step 4 — the SA worklist chip.** `action-section.tsx`: for a `revision` item, show the reason (single-sourced from `APPROVAL_REVISION_REASON_LABEL`) alongside the chip, so the ต้องแก้ไข list tells the SA _why_ at a glance. (Requires the SA action-list to carry `revision_reason` — extend `SaActionItem` + `buildSaActionList` from the same approvals read.)

- [ ] **Step 5 — GREEN + full verify + ship.** Full suite green. Real-flow: a needs_revision WP with each reason renders its specific guidance/CTA (RTL + live-DB substitute for the wedged WP-detail browser). Mutation-check the mismatch-vs-generic branch. Fresh-eyes + ship.

---

## Self-Review (against the spec)

- **Coverage:** D1/D4 → U1 (required reason, RPC validation) + U2 (form requires it). D2 → U1 enum + U2 labels. D3 → U3 guidance/CTA. D5 (measurable) → the column itself (U1) + a one-line query, no console. D6 (no auto-remove; uploader deletes via 291) → U3 links to the delete window, never auto-removes.
- **Sequencing:** U1 merged + `db:types` BEFORE U2 (the enum type + `Constants.public.Enums.approval_revision_reason` must exist); U2 before U3 (labels + guidance SSOT + the reason plumbed through). Serialize — all three touch the same approval surface.
- **Type consistency:** `approval_revision_reason` codes {incomplete, mismatch, premature} identical in the migration, `APPROVAL_REVISION_REASON_LABEL`, `REVISION_REASON_GUIDANCE`, and the form state. `RecordDecisionInput.revisionReason` ↔ `p_revision_reason`.
- **Non-goals honored:** no photo-move; no capture-time prevention; reject-work untouched (its comment-required + audit write preserved by U1).
- **Placeholder scan:** the migration body deliberately shows `…carry verbatim…` for the parts sourced from the LIVE function (per the "never trust a migration file" rule) — the implementer pastes the live body; the CHANGED fragments are concrete. Not a placeholder-defect; it is the correct instruction for a DEFINER DROP+CREATE.
