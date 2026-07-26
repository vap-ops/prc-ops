# Spec 363 U1 — หมายเหตุ moves into the ⓘ sheet

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo additionally requires the `ship-unit` skill for the gate order and the PR.

**Goal:** Move the work package's `หมายเหตุ` out of the `ข้อมูล` tab into the header ⓘ sheet, and make that ⓘ button render unconditionally so the notes can never become unreachable.

**Architecture:** `WorkPackageInfoButton` already owns an ⓘ chip and a `BottomSheet` holding the contractor block and the read-only description (spec 94). It gains two props — `notes` and `canEditNotes` — and renders either the existing `WorkPackageNotes` editor (site staff) or read-only text (procurement). The page stops gating the button on `assignedContractor || wp.description` and drops the notes card from the `ข้อมูล` tab panel, which is left holding `ประวัติการตรวจ` alone.

**Tech Stack:** Next.js App Router (Server Components by default), React 19, TypeScript strict, Vitest + React Testing Library, Tailwind with the Field-First token system.

## Global Constraints

- **Spec 363 D2 is the authority:** the ⓘ renders unconditionally; `ข้อมูล` survives this unit thinned to `ประวัติการตรวจ` alone. **U1 must not delete the `ข้อมูล` tab** — U2 deletes it, because U2's timeline is what re-homes the review history (`page.tsx:747` is its only render site; the attention card at `:945` carries only the latest decision).
- TDD is binding: the failing test is written and _seen to fail_ before any production code. State "Writing failing test first."
- Implement exactly this scope. No extra fields, helpers, validation, or "while I'm here" changes — out-of-scope additions are rejected in review.
- Raw Tailwind palette colours are banned; use the `globals.css` token classes already used in the file (`text-meta`, `text-body`, `text-ink`, `text-ink-secondary`).
- Every user-facing term that appears in 2+ places belongs in `src/lib/i18n/labels.ts`. **This unit introduces no new term** — `หมายเหตุ` already ships as `NotesField`'s default label.
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`).
- Mutation-check every assertion over rendered copy: break the production code by hand, watch it RED, restore. **Commit before mutating** — `git checkout --` restores to HEAD, not to your working tree.

---

## File Structure

| File                                                                  | Responsibility after this unit                                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/components/features/work-packages/work-package-info-button.tsx`  | The ⓘ chip + sheet. Owns contractor, description, **and now notes** (editor or read-only text).                               |
| `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx` | Renders the ⓘ **unconditionally** with the new props; the `ข้อมูล` tab panel keeps only `ประวัติการตรวจ` plus an empty state. |
| `tests/unit/work-package-info-button.test.tsx`                        | Existing spec-94 tests plus the three new notes cases.                                                                        |

**Interfaces:**

- Consumes: `WorkPackageNotes({ projectId, workPackageId, notes })` from `@/components/features/work-packages/work-package-notes` — a client wrapper over `NotesField` that renders its own `<label>หมายเหตุ</label>`, a `<textarea id="wp-notes">`, and a `บันทึกหมายเหตุ` button.
- Produces: `WorkPackageInfoButton` gains two **required** props — `notes: string | null` and `canEditNotes: boolean`. Required, not optional: TypeScript then enumerates the call site rather than letting it default silently.

⚠️ **Do not add your own `หมายเหตุ` heading above the editor.** `NotesField` already renders that label; a second one makes `getByLabelText("หมายเหตุ")` ambiguous and the test will throw. The read-only branch _does_ render the heading, because it has no label of its own.

---

### Task 1: หมายเหตุ in the ⓘ sheet, and the ⓘ always present

**Files:**

- Modify: `src/components/features/work-packages/work-package-info-button.tsx`
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx` (the `actions=` prop on `DetailHeader`, and the `info` tab panel)
- Test: `tests/unit/work-package-info-button.test.tsx`

- [ ] **Step 1: Write the failing tests.** State "Writing failing test first."

Add the notes-actions mock beside the existing mocks at the top of the file:

```tsx
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/notes-actions", () => ({
  setWorkPackageNotes: vi.fn().mockResolvedValue({ ok: true }),
}));
```

Extend the shared `PROPS` object with the two new props:

```tsx
  notes: "ระวังท่อน้ำใต้พื้น",
  canEditNotes: true,
```

Then add these cases inside the existing `describe("WorkPackageInfoButton", …)`:

```tsx
it("shows the notes editor in the sheet for a viewer who may edit", () => {
  render(<WorkPackageInfoButton {...PROPS} />);
  fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
  const field = screen.getByLabelText("หมายเหตุ");
  expect(field).toHaveValue("ระวังท่อน้ำใต้พื้น");
  expect(field.tagName).toBe("TEXTAREA");
});

it("shows notes as read-only text when the viewer may not edit", () => {
  render(<WorkPackageInfoButton {...PROPS} canEditNotes={false} />);
  fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
  expect(screen.getByText("ระวังท่อน้ำใต้พื้น")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("renders an em dash for a read-only viewer when there are no notes", () => {
  render(<WorkPackageInfoButton {...PROPS} canEditNotes={false} notes={null} />);
  fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("renders the ⓘ trigger even with no contractor and no description", () => {
  render(
    <WorkPackageInfoButton {...PROPS} contractor={null} contractorId={null} description={null} />,
  );
  expect(screen.getByRole("button", { name: "ข้อมูลงาน" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ข้อมูลงาน" }));
  expect(screen.getByLabelText("หมายเหตุ")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run tests/unit/work-package-info-button.test.tsx`
Expected: FAIL. The first three error on the missing `หมายเหตุ` label/text; TypeScript also flags `notes` and `canEditNotes` as unknown props.

- [ ] **Step 3: Add the props and the notes section to the component**

In `work-package-info-button.tsx`, add the import:

```tsx
import { WorkPackageNotes } from "@/components/features/work-packages/work-package-notes";
```

Extend the props interface:

```tsx
/** Spec 363 U1 — หมายเหตุ moved out of the ข้อมูล tab into this sheet. */
notes: string | null;
/** Site staff edit notes in place; the read-only viewer (procurement) sees text. */
canEditNotes: boolean;
```

Destructure `notes` and `canEditNotes` in the function signature, then add this as the **last** child inside the sheet's `<div className="flex flex-col gap-4">`, after the description block:

```tsx
{
  /* Spec 363 U1 — notes render unconditionally: for an editor this is the
              only entry point to add them, and the read-only viewer keeps the
              em-dash the ข้อมูล tab used to show. NotesField supplies its own
              หมายเหตุ label, so the editable branch adds no heading of its own. */
}
{
  canEditNotes ? (
    <WorkPackageNotes projectId={projectId} workPackageId={workPackageId} notes={notes} />
  ) : (
    <div className="flex flex-col gap-1">
      <p className="text-meta text-ink-secondary">หมายเหตุ</p>
      <p className="text-body text-ink-secondary whitespace-pre-wrap">
        {notes?.trim() ? notes : "—"}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run tests/unit/work-package-info-button.test.tsx`
Expected: PASS, all cases including the four pre-existing spec-94 ones.

- [ ] **Step 5: Render the ⓘ unconditionally and thin the ข้อมูล tab**

In `page.tsx`, replace the conditional `actions=` expression (currently `assignedContractor || wp.description ? <WorkPackageInfoButton … /> : null`) with an unconditional element carrying the two new props:

```tsx
        actions={
          // Spec 363 U1 (D2): unconditional — the sheet now holds หมายเหตุ, so
          // gating on contractor-or-description would make notes unreachable on
          // a bare WP.
          <WorkPackageInfoButton
            projectId={wp.project_id}
            workPackageId={wp.id}
            contractor={
              assignedContractor
                ? { name: assignedContractor.name, phone: assignedContractor.phone }
                : null
            }
            description={wp.description}
            isAssigner={isAssigner}
            contractors={pickerContractors}
            contractorId={wp.contractor_id}
            notes={wp.notes}
            canEditNotes={!readOnly}
          />
        }
```

In the same file's `info` tab panel, delete the entire notes `<div className={CARD}>…</div>` (the block holding both the `readOnly` `หมายเหตุ` paragraph and the `<WorkPackageNotes …>` editor) and give the now-possibly-empty panel an empty state. The panel body becomes:

```tsx
<>
  {/* Spec 363 U1: หมายเหตุ moved to the header ⓘ sheet. This tab is now
              ประวัติการตรวจ only, and U2 retires it once the timeline lands. */}
  {approvals.length > 0 ? (
    <details className={CARD}>
      <summary className="text-body text-ink cursor-pointer font-semibold">
        ประวัติการตรวจ ({approvals.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {approvals.map((a) => (
          <li key={a.id} className="border-edge border-t pt-2 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <StatusPill
                pillClasses={approvalDecisionPillClasses(a.decision)}
                icon={approvalDecisionIcon(a.decision)}
              >
                {APPROVAL_DECISION_LABEL[a.decision]}
              </StatusPill>
              <span className="text-meta text-ink-secondary">
                {displayNames.get(a.decided_by) ?? "—"} · {formatThaiDateTime(a.decided_at)}
              </span>
            </div>
            {a.comment ? (
              <p className="text-body text-ink-secondary mt-1 whitespace-pre-wrap">{a.comment}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  ) : (
    <p className={`${CARD} text-body text-ink-secondary`}>ยังไม่มีประวัติการตรวจ</p>
  )}
</>
```

Then remove the now-unused `WorkPackageNotes` import from `page.tsx` — `pnpm typecheck` and lint will name it if you miss it.

- [ ] **Step 6: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. If a WP-detail page test asserted the notes editor inside the `ข้อมูล` tab, it fails here — update it to assert the editor is reachable from the ⓘ instead. Do not weaken it to a bare existence check.

- [ ] **Step 7: Commit before mutating**

```bash
git add src/components/features/work-packages/work-package-info-button.tsx src/app/projects/\[projectId\]/work-packages/\[workPackageId\]/page.tsx tests/unit/work-package-info-button.test.tsx
git commit -m "feat(wp): move หมายเหตุ into the ⓘ sheet and render it unconditionally"
```

- [ ] **Step 8: Mutation-check the three new assertions**

For each mutation: confirm it actually applied (grep the changed line), run the test, read the count so you know tests _ran_, then restore with `git checkout --` — safe now that Step 7 committed.

1. Flip `canEditNotes ?` to `!canEditNotes ?` → the editor and read-only cases must both RED.
2. Replace `{notes?.trim() ? notes : "—"}` with `{notes}` → the em-dash case must RED.
3. Re-gate the page's `actions=` on `assignedContractor || wp.description` → the no-contractor-no-description case must RED.

Run each as: `pnpm exec vitest run tests/unit/work-package-info-button.test.tsx`
Expected each time: `Tests N failed | M passed` — **a run reporting 0 tests ran is an abort, not a pass.**

- [ ] **Step 9: Real-flow verify in the browser**

Log in per the `dev-preview-login` recipe, open a WP detail page, and confirm: the ⓘ appears in the header; tapping it opens the sheet with a `หมายเหตุ` textarea; typing and pressing `บันทึกหมายเหตุ` saves and the value survives a reload; the `ข้อมูล` tab no longer shows a notes editor. Zero console errors. Then open a WP with **no contractor and no description** and confirm the ⓘ is still there.

- [ ] **Step 10: Fresh-eyes review, then ship**

Follow the `ship-unit` skill's gates 5 and 6: a reviewer reads the full diff and every finding is addressed or answered, then `scripts/ship-pr.sh` proves the merge and opens the PR. Update `docs/progress-tracker.md` marking U1 complete with the decisions made.

---

## Self-Review

**Spec coverage.** Spec 363 D2 has three parts: the ⓘ absorbs `หมายเหตุ` (Step 3), the button renders unconditionally (Step 5), `ข้อมูล` thins rather than dies (Step 5, with the U2 hand-off noted in Global Constraints). All three are covered, and the corrected order from PR #781 is honoured — no tab deletion here.

**Placeholder scan.** No TBDs. Every code step carries the real code; every command carries its expected result.

**Type consistency.** `notes: string | null` and `canEditNotes: boolean` are named identically in the interface, the destructure, the page call site, and the tests. `WorkPackageNotes` is called with exactly the props its own interface declares (`projectId`, `workPackageId`, `notes`).

**Known gap, deliberately left:** `ยังไม่มีประวัติการตรวจ` is a one-unit-lived string — U2 deletes the tab that renders it. It is not routed through `labels.ts` because it never appears in a second place. If U2 slips, revisit.
