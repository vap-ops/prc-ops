# Spec 353 — WP rejection paths + หลังแก้ไข availability — Implementation Plan

> **For agentic workers:** load the `ship-unit` skill for EVERY task — each task is one PR through the gate (lane claim → dependency gate-check → RED-first → real-flow verify → fresh-eyes → gated ship). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Gate the หลังแก้ไข (after_fix) photo capture to genuine rework cycles (keeping its history visible), enforce the same rule in the write path, and make the PM's two rejections (reject-evidence vs reject-work) read clearly and consistently.

**Architecture:** One new pure predicate `canCaptureAfterFix` (beside `canDeleteWpPhotos`, reusing `isRevisionWindowOpen`) splits the conflated `showAfterFix` boolean into _capture_ vs _history_. The WP-detail page passes the precise capture flag to the capture zone; the `addPhoto` server action re-enforces the same predicate; the two rejection labels are sharpened and single-sourced; the resubmit gate keys on the current evidence phase. No schema, no migration.

**Tech Stack:** Next.js 16 App Router (RSC), TypeScript strict, Vitest + RTL, Supabase (RLS unchanged). Thai UI copy.

## Global Constraints

- **TDD, RED first.** Every task's first commit is the failing test; state "Writing failing test first." No production code before a seen-failing test.
- **No schema / no migration.** Code-only. Do NOT touch `supabase/migrations/`. The `photo_logs` INSERT RLS is deliberately unchanged (a DB guard is a recorded non-goal).
- **`decide_work_package` RPC is untouched.** This plan is the UI / label / write-action layer only.
- **Shared predicates, no drift.** The capture rule lives in exactly one pure function used by both the page and the action.
- **Assertions pin absence, mutation-checked.** For any `toContain`/`not.toContain` over source or rendered text, break the production line by hand, watch it RED, restore (doctrine). Pin retired literals BARE.
- **Thai copy is operator-owned.** The D5 strings below are the approved proposal; if the operator later tweaks wording, change the SSOT string only.
- **`src/lib/i18n/labels.ts` is a shared SSOT** — this lane is the only one touching it (LANES claim `353reject`); serialize if another lane appears.

---

## File Structure

| File                                                                            | Responsibility                                                                                      | Task |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---- |
| `src/lib/photos/deletable.ts`                                                   | + `canCaptureAfterFix({status,reworkRound,revisionWindowOpen})` pure predicate                      | T1   |
| `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx`           | compute `revisionWindowOpen` + `showAfterFixCapture` + `showAfterFixHistory`; feed the capture zone | T1   |
| `src/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader.tsx` | after_fix tile = shutter when capture, read-only strip when history-only                            | T1   |
| `src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts`         | `addPhoto` refuses an after_fix insert outside the capture window                                   | T2   |
| `src/lib/i18n/labels.ts`                                                        | `APPROVAL_DECISION_LABEL` = single sharpened SSOT for both registers                                | T3   |
| `src/app/review/work-packages/[workPackageId]/record-decision-form.tsx`         | labels from the SSOT; sharpened hints; delete local `DECISION_LABEL`                                | T3   |
| `.../work-packages/[workPackageId]/page.tsx` (attention CTA)                    | needs_revision CTA names the evidence phase                                                         | T3   |
| `src/lib/approvals/resubmit.ts`                                                 | resubmit gate keys on `reworkRound>0 ? after_fix : after`                                           | T4   |
| `.../page.tsx` (resubmitState call)                                             | pass `reworkRound: wp.rework_round`                                                                 | T4   |

Test files (all existing — extend them): `tests/unit/photo-deletable-revision-window.test.ts`, `tests/unit/phase-uploader-after-fix.test.tsx`, `tests/unit/defect-photo-addphoto.test.ts`, `tests/unit/record-decision-form.test.tsx`, `tests/unit/resubmit-predicates.test.ts`.

---

## Task 1: Split the after_fix gate (capture vs history)

**Files:**

- Modify: `src/lib/photos/deletable.ts` (add predicate)
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx` (~line 396 + PhotoCaptureZone props ~574-587 + readOnly gallery gate ~556)
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader.tsx` (props + after_fix tile ~279-303)
- Test: `tests/unit/photo-deletable-revision-window.test.ts`, `tests/unit/phase-uploader-after-fix.test.tsx`

**Interfaces:**

- Produces: `canCaptureAfterFix({ status: WorkPackageStatus; reworkRound: number; revisionWindowOpen: boolean }): boolean`
- Produces: `PhotoCaptureZone` prop change — `showAfterFix: boolean` → `showAfterFixCapture: boolean` + `showAfterFixHistory: boolean`
- Consumes: existing `isRevisionWindowOpen` (deletable.ts:43), `PhaseData` (phase-uploader), `PHASES` (phases.ts)

- [ ] **Step 1 — failing test for the predicate.** Append to `tests/unit/photo-deletable-revision-window.test.ts`:

```ts
import { canCaptureAfterFix } from "@/lib/photos/deletable";

describe("canCaptureAfterFix — after_fix is capturable only inside a rework cycle", () => {
  const cases: ReadonlyArray<[WorkPackageStatus, number, boolean, boolean]> = [
    // status, reworkRound, revisionWindowOpen, expected
    ["rework", 1, false, true], // actively curing
    ["rework", 3, false, true], // a later round, still curing
    ["pending_approval", 1, true, true], // reworked WP bounced for evidence — re-shoot after_fix
    ["pending_approval", 1, false, false], // reworked WP awaiting first review — wait
    ["pending_approval", 0, true, false], // round-0 revision window → evidence is `after`, not after_fix
    ["pending_approval", 0, false, false], // round-0 first submit
    ["complete", 1, false, false], // reworked then completed — history only
    ["complete", 0, false, false], // the 20 legacy leaked WPs
    ["in_progress", 0, false, false], // never reworked
  ];
  it.each(cases)("%s round=%s window=%s → %s", (status, reworkRound, revisionWindowOpen, want) => {
    expect(canCaptureAfterFix({ status, reworkRound, revisionWindowOpen })).toBe(want);
  });
});
```

- [ ] **Step 2 — run, verify RED.** `cd /d/claude/projects/prc-ops/prc-ops-353reject && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec vitest run tests/unit/photo-deletable-revision-window.test.ts` → FAIL (`canCaptureAfterFix` is not exported).

- [ ] **Step 3 — implement the predicate.** In `src/lib/photos/deletable.ts`, after `canDeleteWpPhotos`:

```ts
/**
 * Spec 353 — WHEN the หลังแก้ไข (after_fix) CAPTURE affordance is offered. after_fix
 * is a WP's completion evidence exactly when it is a rework cycle (`reworkRound > 0`),
 * and only while its photos are mutable: actively curing (`rework`) OR a reworked WP
 * the reviewer bounced for evidence (the revision window). Round-0 WPs (evidence =
 * `after`) and completed WPs never offer it — the read-only history strip carries the
 * past photos instead. Reuses isRevisionWindowOpen so the capture window and the
 * delete window cannot drift.
 */
export function canCaptureAfterFix({
  status,
  reworkRound,
  revisionWindowOpen,
}: {
  status: WorkPackageStatus;
  reworkRound: number;
  revisionWindowOpen: boolean;
}): boolean {
  return reworkRound > 0 && (status === "rework" || revisionWindowOpen);
}
```

- [ ] **Step 4 — run, verify GREEN.** Same vitest command → PASS.

- [ ] **Step 5 — failing test: page routes through the predicate.** Append to the page-routing describe block in the same test file:

```ts
describe("the WP-detail page derives the after_fix capture flag from the predicate", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
    "utf8",
  );
  it("computes showAfterFixCapture via canCaptureAfterFix and history via length", () => {
    expect(pageSrc.replace(/\s+/g, " ")).toContain(
      "canCaptureAfterFix({ status: wp.status, reworkRound: wp.rework_round,",
    );
    expect(pageSrc).toContain("const showAfterFixHistory = photosByPhase.after_fix.length > 0;");
  });
  it("retires the conflated showAfterFix boolean", () => {
    expect(pageSrc).not.toContain("const showAfterFix =");
  });
});
```

- [ ] **Step 6 — run, verify RED.** vitest → FAIL (page still has the old `const showAfterFix =`).

- [ ] **Step 7 — implement the page.** In `page.tsx`, replace the single `const showAfterFix = wp.status === "rework" || photosByPhase.after_fix.length > 0;` (~line 396) with:

```tsx
const revisionWindowOpen = isRevisionWindowOpen({
  status: wp.status,
  latestDecision: latestDecision?.decision ?? null,
  revisionAnswered: latestDecision ? answeredDecisionIds.has(latestDecision.id) : false,
});
const showAfterFixCapture = canCaptureAfterFix({
  status: wp.status,
  reworkRound: wp.rework_round,
  revisionWindowOpen,
});
const showAfterFixHistory = photosByPhase.after_fix.length > 0;
```

Add `canCaptureAfterFix` and `isRevisionWindowOpen` to the existing `@/lib/photos/deletable` import. Then update the two use sites:

- readOnly gallery gate (~line 556): `{showAfterFix` → `{showAfterFixHistory`.
- `<PhotoCaptureZone>` props (~line 580): replace `showAfterFix={showAfterFix}` with `showAfterFixCapture={showAfterFixCapture}` and `showAfterFixHistory={showAfterFixHistory}`.

- [ ] **Step 8 — run, verify GREEN.** vitest → PASS. Mutation-check: flip `> 0` to `>= 0` in the predicate, confirm the `["complete", 0, …]` case REDs, restore.

- [ ] **Step 9 — failing test: the tile mode split.** In `tests/unit/phase-uploader-after-fix.test.tsx`, change `renderZone` to take the two flags and add read-only-mode coverage:

```tsx
function renderZone(
  props: {
    showAfterFixCapture?: boolean;
    showAfterFixHistory?: boolean;
    currentReworkRound?: number;
    afterFixPhotos?: PhaseData["photos"];
  } = {},
) {
  const zonePhases = PHASES.map(({ phase, label }) => ({
    phase,
    label,
    photos: phase === "after_fix" ? (props.afterFixPhotos ?? []) : [],
    lastUpdatedLabel: null,
  }));
  return render(
    <PhotoCaptureZone
      projectId="p1"
      workPackageId="w1"
      userId="u1"
      phases={zonePhases}
      currentPhase="before"
      showAfterFixCapture={props.showAfterFixCapture ?? true}
      showAfterFixHistory={props.showAfterFixHistory ?? true}
      currentReworkRound={props.currentReworkRound ?? 1}
      canDelete
      removedTrace={[]}
    />,
  );
}

it("shows a tappable หลังแก้ไข shutter when capture is allowed", () => {
  renderZone({ showAfterFixCapture: true, showAfterFixHistory: true });
  expect(screen.getByRole("button", { name: "ถ่ายรูป หลังแก้ไข" })).toBeEnabled();
});

it("history-only: shows the past after_fix photos read-only, NO shutter", () => {
  renderZone({
    showAfterFixCapture: false,
    showAfterFixHistory: true,
    afterFixPhotos: [{ id: "a1", url: "/x.jpg", seq: 1, timeLabel: "22 ก.ค.", uploaderName: null }],
  });
  expect(screen.queryByRole("button", { name: "ถ่ายรูป หลังแก้ไข" })).not.toBeInTheDocument();
  expect(screen.getByText("#1")).toBeInTheDocument(); // the photo still shows
});

it("hides หลังแก้ไข entirely when there is neither capture nor history", () => {
  renderZone({ showAfterFixCapture: false, showAfterFixHistory: false });
  expect(screen.queryByRole("button", { name: "ถ่ายรูป หลังแก้ไข" })).not.toBeInTheDocument();
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
});
```

Update the pre-existing tests in this file that pass `showAfterFix` to the new prop names (capture-mode tests → `showAfterFixCapture: true`; the round-label test keeps `showAfterFixCapture: true`; the removal-trace tests pass both flags `false`).

- [ ] **Step 10 — run, verify RED.** `pnpm exec vitest run tests/unit/phase-uploader-after-fix.test.tsx` → FAIL (prop `showAfterFix` unknown / read-only strip absent).

- [ ] **Step 11 — implement phase-uploader.** In `phase-uploader.tsx`:
  1. `PhotoCaptureZoneProps`: replace `showAfterFix: boolean;` with `showAfterFixCapture: boolean;` and `showAfterFixHistory: boolean;` (update the JSDoc to the spec-353 rule).
  2. Destructure both in the component signature.
  3. Replace `const afterFix = showAfterFix ? (phases.find((p) => p.phase === "after_fix") ?? null) : null;` with:

```tsx
const afterFixData = phases.find((p) => p.phase === "after_fix") ?? null;
const afterFix = showAfterFixCapture ? afterFixData : null;
const afterFixHistory = !showAfterFixCapture && showAfterFixHistory ? afterFixData : null;
```

4. Keep the existing `{afterFix && (…)}` shutter block unchanged. Directly after it, add the read-only history block:

```tsx
{
  afterFixHistory && (
    <div className="border-edge border-t pt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="border-edge-strong bg-card text-ink-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2">
          <RotateCcw aria-hidden className="h-4 w-4" />
        </span>
        <h3 className="text-body text-ink font-bold">
          {afterFixHistory.label}
          <span className="text-meta text-ink-secondary ml-1.5 font-semibold">
            {afterFixHistory.photos.length} รูป
          </span>
        </h3>
      </div>
      <PhotoStrip>
        {afterFixHistory.photos.map((p) => (
          <li key={p.id} className={PHOTO_STRIP_TILE}>
            {p.url ? (
              <ZoomablePhoto src={p.url} photoId={p.id} uploaderName={p.uploaderName} />
            ) : (
              <div className="text-meta text-ink-secondary flex h-full w-full items-center justify-center">
                ไม่พร้อมแสดง
              </div>
            )}
            <span className="pointer-events-none absolute top-0 left-0 rounded-br-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">
              #{p.seq}
            </span>
          </li>
        ))}
      </PhotoStrip>
    </div>
  );
}
```

(`RotateCcw`, `PhotoStrip`, `PHOTO_STRIP_TILE`, `ZoomablePhoto` are already imported.)

- [ ] **Step 12 — run, verify GREEN.** vitest for the file → PASS. Mutation-check: temporarily force `showAfterFixCapture={false}` on a real render path and confirm the history test's "no shutter" holds; restore.

- [ ] **Step 13 — full suite + typecheck.** `pnpm typecheck && pnpm exec vitest run tests/unit/photo-deletable-revision-window.test.ts tests/unit/phase-uploader-after-fix.test.tsx` green.

- [ ] **Step 14 — real-flow verify + ship (ship-unit skill).** Dev-preview login; open a `complete` WP that carries after_fix photos (e.g. one of the 20) → the หลังแก้ไข section shows photos with **no** shutter; open a hand-driven `rework` WP → shutter present. RSC/RTL substitute if the in-app browser wedges the WP-detail surface (documented). Then fresh-eyes review + `scripts/ship-pr.sh` (code-only → auto-merge on green).

---

## Task 2: Server-action gate on after_fix insert

**Files:**

- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts` (`addPhoto`, after the `defect` scope block ~line 142)
- Test: `tests/unit/defect-photo-addphoto.test.ts`

**Interfaces:**

- Consumes: `canCaptureAfterFix` + `isRevisionWindowOpen` (T1, deletable.ts)
- The WP row `addPhoto` already selects (`id, project_id, status, rework_round`) is sufficient for the `rework` short-circuit; the revision-window read runs only for `after_fix` on a non-`rework` WP.

- [ ] **Step 1 — failing tests.** In `tests/unit/defect-photo-addphoto.test.ts`, extend `rlsClient()` to serve the two reads the gate makes on a non-rework WP, then add cases. Add to the `from` switch:

```ts
if (table === "approvals") {
  return {
    select: () => ({
      eq: () => ({
        order: () => ({ order: () => ({ limit: () => ({ maybeSingle: approvalsMock }) }) }),
      }),
    }),
  };
}
if (table === "audit_log") {
  return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => auditMock() }) }) }) };
}
```

Add `approvalsMock`/`auditMock` to the `vi.hoisted` block; default them in `beforeEach` to `approvalsMock.mockResolvedValue({ data: null })` and `auditMock.mockResolvedValue({ data: [] })`. Then:

```ts
describe("addPhoto after_fix capture window (spec 353)", () => {
  it("admits after_fix on a WP in rework (no approvals read needed)", async () => {
    setup("site_admin", "rework", 1);
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r).toMatchObject({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "after_fix" }));
  });

  it("refuses after_fix on a completed WP (the 20-WP leak)", async () => {
    setup("site_admin", "complete", 1);
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses after_fix on a round-0 pending_approval WP (evidence is `after`)", async () => {
    setup("site_admin", "pending_approval", 0);
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("admits after_fix on a reworked pending_approval WP inside the revision window", async () => {
    setup("site_admin", "pending_approval", 1);
    approvalsMock.mockResolvedValue({ data: { id: "dec1", decision: "needs_revision" } });
    auditMock.mockResolvedValue({ data: [] }); // not answered → window open
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r).toMatchObject({ ok: true });
  });

  it("refuses after_fix once that revision was answered (window closed)", async () => {
    setup("site_admin", "pending_approval", 1);
    approvalsMock.mockResolvedValue({ data: { id: "dec1", decision: "needs_revision" } });
    auditMock.mockResolvedValue({ data: [{ payload: { answers_decision_id: "dec1" } }] });
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
```

Note the existing `addPhoto answersPhotoId` tests all use `status: "rework"`, so the `rework` short-circuit keeps them green with no mock change.

- [ ] **Step 2 — run, verify RED.** `pnpm exec vitest run tests/unit/defect-photo-addphoto.test.ts` → the complete/round-0/answered cases FAIL (insert currently proceeds).

- [ ] **Step 3 — implement the gate.** In `addPhoto`, immediately after the `if (input.phase === "defect") { … }` block, add:

```ts
// Spec 353: หลังแก้ไข is capturable only inside a rework cycle. Mirrors the
// canCaptureAfterFix predicate the WP-detail page uses, so the tile the SA sees
// and the write the server accepts cannot drift. The revision-window read runs
// only for after_fix on a non-rework WP (rare); `rework` short-circuits it.
if (input.phase === "after_fix") {
  let revisionWindowOpen = false;
  if (wp.status !== "rework") {
    const { data: latest } = await supabase
      .from("approvals")
      .select("id, decision")
      .eq("work_package_id", wp.id)
      .order("decided_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    let revisionAnswered = false;
    if (latest?.decision === "needs_revision") {
      const { data: resubmits } = await supabase
        .from("audit_log")
        .select("payload")
        .eq("target_table", "work_packages")
        .eq("target_id", wp.id)
        .eq("payload->>event", "wp_evidence_resubmitted");
      revisionAnswered = (resubmits ?? []).some(
        (r) =>
          (r.payload as { answers_decision_id?: string } | null)?.answers_decision_id === latest.id,
      );
    }
    revisionWindowOpen = isRevisionWindowOpen({
      status: wp.status,
      latestDecision: latest?.decision ?? null,
      revisionAnswered,
    });
  }
  if (
    !canCaptureAfterFix({ status: wp.status, reworkRound: wp.rework_round, revisionWindowOpen })
  ) {
    return { ok: false, error: "ถ่ายรูปหลังแก้ไขได้เฉพาะตอนที่งานอยู่ระหว่างแก้ไข" };
  }
}
```

Import `canCaptureAfterFix` and `isRevisionWindowOpen` from `@/lib/photos/deletable`. Place the block BEFORE `storagePath` is built so a refused insert touches no storage row.

- [ ] **Step 4 — run, verify GREEN.** vitest for the file → PASS. Mutation-check: delete the `if (!canCaptureAfterFix(...))` return, confirm the complete + round-0 cases RED, restore.

- [ ] **Step 5 — typecheck + real-flow + ship.** `pnpm typecheck` green. Real-flow: attempt an after_fix upload against a `complete` WP via the action path (or verify the tile is gone from T1 so the path is unreachable through the UI) — the action refuses. Fresh-eyes + ship-unit. (Note: `actions.ts` here is the WP photo action, not a danger path — code-only auto-merge.)

---

## Task 3: Rejection framing + label SSOT

**Files:**

- Modify: `src/lib/i18n/labels.ts` (`APPROVAL_DECISION_LABEL` ~line 780)
- Modify: `src/app/review/work-packages/[workPackageId]/record-decision-form.tsx` (labels + hints ~28-38)
- Modify: `.../work-packages/[workPackageId]/page.tsx` (needs_revision CTA ~926-932)
- Test: `tests/unit/record-decision-form.test.tsx` (+ verify `tests/unit/i18n-labels.test.ts` stays green)

**Interfaces:**

- `APPROVAL_DECISION_LABEL: Record<approval_decision,string>` becomes the SINGLE label home, imperative register, consumed by the form, the WP-detail attention card, `/review`, and `compose-notification`.
- The form keeps a local `DECISION_HINT` (hints are form-only); its local `DECISION_LABEL` is DELETED.

- [ ] **Step 1 — grep the blast radius first.** `grep -rn 'อนุมัติแล้ว\|ไม่อนุมัติ' src/ tests/` and `grep -rn 'APPROVAL_DECISION_LABEL' src/`. Confirm no test asserts the literal old result strings beyond `record-decision-form.test.tsx` (which this task updates) and that `/review` + `compose-notification` only _render_ the map. If a hard dependency on `"อนุมัติแล้ว"` surfaces, keep `approved` as `"อนุมัติแล้ว"` and sharpen only the two rejection keys (record the deviation in the tracker).

- [ ] **Step 2 — failing test.** Update `tests/unit/record-decision-form.test.tsx`:

```ts
it("names the reject-evidence choice as a photo re-shoot, work untouched", () => {
  render(<RecordDecisionForm workPackageId={WP} />);
  expect(screen.getByText("ถ่ายรูปใหม่")).toBeInTheDocument();
  expect(screen.getByText(/งานไม่ต้องแก้/)).toBeInTheDocument();
  expect(screen.getByText(/ยังอยู่ในคิวตรวจ/)).toBeInTheDocument();
});
it("names the reject-work choice and where the WP lands", () => {
  render(<RecordDecisionForm workPackageId={WP} />);
  expect(screen.getByText("ส่งกลับแก้งาน")).toBeInTheDocument();
  expect(screen.getByText(/จะกลับไปเป็นงานแก้ไข/)).toBeInTheDocument();
});
it("retires the stale ไม่อนุมัติ and the vague ให้แก้ไข labels", () => {
  render(<RecordDecisionForm workPackageId={WP} />);
  expect(screen.queryByText("ไม่อนุมัติ")).not.toBeInTheDocument();
  expect(screen.queryByText("ให้แก้ไข")).not.toBeInTheDocument();
});
it("offers exactly the three decisions", () => {
  render(<RecordDecisionForm workPackageId={WP} />);
  expect(screen.getAllByRole("radio")).toHaveLength(3);
});
```

(Delete the old `ให้แก้ไข`-present and `ส่งกลับแก้งาน`-basic assertions superseded above.)

- [ ] **Step 3 — run, verify RED.** `pnpm exec vitest run tests/unit/record-decision-form.test.tsx` → FAIL.

- [ ] **Step 4 — implement the SSOT.** In `src/lib/i18n/labels.ts`, set (imperative, sharpened):

```ts
export const APPROVAL_DECISION_LABEL: Record<Enums["approval_decision"], string> = {
  approved: "อนุมัติ",
  needs_revision: "ถ่ายรูปใหม่",
  rejected: "ส่งกลับแก้งาน",
};
```

- [ ] **Step 5 — point the form at the SSOT.** In `record-decision-form.tsx`: delete the local `DECISION_LABEL` const; import `APPROVAL_DECISION_LABEL` from `@/lib/i18n/labels`; render `{APPROVAL_DECISION_LABEL[d]}` where `{DECISION_LABEL[d]}` was. Replace `DECISION_HINT` with the sharpened D5 hints:

```ts
const DECISION_HINT: Record<ApprovalDecision, string> = {
  approved: "รายการงานจะเปลี่ยนเป็นเสร็จสิ้น",
  needs_revision:
    "รูปหลักฐานไม่ครบหรือไม่ชัด — ถ่ายใหม่แล้วส่งตรวจอีกครั้ง · ยังอยู่ในคิวตรวจ (งานไม่ต้องแก้)",
  rejected: "ตัวงานต้องแก้ไข — จะกลับไปเป็นงานแก้ไข (รอบใหม่) แล้วถ่ายรูปหลังแก้ไข",
};
```

- [ ] **Step 6 — run, verify GREEN.** `pnpm exec vitest run tests/unit/record-decision-form.test.tsx tests/unit/i18n-labels.test.ts` → PASS (the i18n enum-completeness harness only checks non-empty per key). Mutation-check: revert `needs_revision` to `"ให้แก้ไข"`, confirm the "retires ให้แก้ไข" test REDs, restore.

- [ ] **Step 7 — failing test: the CTA names the evidence phase.** Add to the WP-detail page-source pin test (reuse the `tests/unit/photo-deletable-revision-window.test.ts` page-source block, or the nearest page-source test):

```ts
it("the needs_revision CTA names the evidence phase, not a generic ถ่ายรูปเพิ่ม", () => {
  expect(pageSrc).toContain(
    'wp.rework_round > 0 ? "ถ่ายรูปหลังแก้ไขใหม่" : "ถ่ายรูปหลังทำงานใหม่"',
  );
  expect(pageSrc).not.toContain(">ถ่ายรูปเพิ่ม<");
});
```

- [ ] **Step 8 — run RED, implement CTA.** In `page.tsx` attention-card link (~line 931), replace the literal `ถ่ายรูปเพิ่ม` text with `{wp.rework_round > 0 ? "ถ่ายรูปหลังแก้ไขใหม่" : "ถ่ายรูปหลังทำงานใหม่"}`. Run → GREEN.

- [ ] **Step 9 — full suite + real-flow + ship.** `pnpm lint && pnpm typecheck && pnpm test` green. Real-flow: on `/review`, the PM form shows the three sharpened options; on a needs_revision WP the SA's attention card title reads "ถ่ายรูปใหม่" (not "ไม่อนุมัติ") and the CTA names the phase; a decided-WP `/review` row and a `wp_decision` notification render the sharpened label. Fresh-eyes + ship-unit. **`labels.ts` is a shared SSOT — confirm the lane is still the only writer before pushing.**

---

## Task 4: Resubmit evidence-phase alignment

**Files:**

- Modify: `src/lib/approvals/resubmit.ts` (`ResubmitStateArgs` + `resubmitState` ~78-127)
- Modify: `.../work-packages/[workPackageId]/page.tsx` (the `resubmitState({...})` call — add `reworkRound`)
- Test: `tests/unit/resubmit-predicates.test.ts`

**Interfaces:**

- `ResubmitStateArgs` gains `reworkRound: number`.
- `resubmitState` unlocks on a new photo in the CURRENT evidence phase: `reworkRound > 0 ? currentPhotos.after_fix : currentPhotos.after`.

- [ ] **Step 1 — failing tests.** In `tests/unit/resubmit-predicates.test.ts`, add `reworkRound: 0` to the `state()` helper defaults, then:

```ts
// round-0 (never reworked): evidence is `after`; a new after_fix must NOT unlock.
it("round-0: a new after unlocks, a new after_fix does not", () => {
  expect(
    state({ reworkRound: 0, currentPhotos: { after: [{ created_at: AFTER }], after_fix: [] } })
      .kind,
  ).toBe("ready");
  expect(
    state({ reworkRound: 0, currentPhotos: { after: [], after_fix: [{ created_at: AFTER }] } })
      .kind,
  ).toBe("blocked");
});
// reworked: evidence is after_fix; a new after_fix unlocks, a stray new after does not.
it("reworked: a new after_fix unlocks, a new after does not", () => {
  expect(
    state({ reworkRound: 1, currentPhotos: { after: [], after_fix: [{ created_at: AFTER }] } })
      .kind,
  ).toBe("ready");
  expect(
    state({ reworkRound: 1, currentPhotos: { after: [{ created_at: AFTER }], after_fix: [] } })
      .kind,
  ).toBe("blocked");
});
```

Update the pre-existing `"unlocks on a new after_fix photo (a rework round that bounced)"` test to pass `reworkRound: 1` (it asserts after_fix unlocks — only true for a reworked WP now). The `"unlocks on a new after photo"` test keeps the default `reworkRound: 0`.

- [ ] **Step 2 — run, verify RED.** `pnpm exec vitest run tests/unit/resubmit-predicates.test.ts` → the new + amended cases FAIL (current gate is after-OR-after_fix regardless of round).

- [ ] **Step 3 — implement.** In `resubmit.ts`: add `reworkRound: number;` to `ResubmitStateArgs` (documented: "the WP's rework_round — decides which phase is completion evidence"). In `resubmitState`, replace the block at ~line 120-124 with:

```ts
const boundary = Date.parse(latestDecision.decided_at);
const isNew = (p: PhotoStamp) => Date.parse(p.created_at) > boundary;
// Spec 353: the completion evidence is after_fix for a reworked WP (rework_round>0),
// else the `after` photo — so reject-evidence points at exactly one phase to re-shoot.
const evidence = reworkRound > 0 ? currentPhotos.after_fix : currentPhotos.after;
if (!evidence.some(isNew)) {
  return { kind: "blocked", hint: RESUBMIT_EVIDENCE_HINT };
}
```

Destructure `reworkRound` from `args` at the top of the function.

- [ ] **Step 4 — thread the arg from the page.** In `page.tsx`, the `resubmitState({ … })` call adds `reworkRound: wp.rework_round,`.

- [ ] **Step 5 — run, verify GREEN.** vitest for the file → PASS. `pnpm typecheck` (the new required arg surfaces any missed call site). Mutation-check: hard-code `reworkRound = 0` inside `resubmitState`, confirm the reworked-unlock test REDs, restore.

- [ ] **Step 6 — full suite + real-flow + ship.** `pnpm test` green. Real-flow: a round-0 needs_revision WP goes `ready` only after a new `after` photo; a reworked needs_revision WP only after a new after_fix. Fresh-eyes + ship-unit.

---

## Self-Review (against the spec)

- **Spec coverage:** D1/D2/D3 → T1; D4 → T2; D5/D6/D7 → T3; D8 → T4. Every decision maps to a task.
- **Non-goals respected:** no migration; no cleanup of the 151 legacy rows (they render as read-only history via T1); the broader "INSERT RLS has no status gate for any phase" hole is untouched; `decide_work_package` untouched.
- **Type consistency:** `canCaptureAfterFix({status, reworkRound, revisionWindowOpen})` — identical signature in deletable.ts (T1), the page (T1), and `addPhoto` (T2). `ResubmitStateArgs.reworkRound` (T4) matches the page's `wp.rework_round`.
- **Placeholder scan:** every step carries real test + implementation code and an exact command. No TBD.
- **Register note (D6):** a literal single-string merge would force `approved`'s result label (`"อนุมัติแล้ว"`) to equal the imperative `"อนุมัติ"`; T3 Step 1 greps for that literal and keeps a fallback (keep `approved`'s result string, sharpen the two rejections only) if a hard dependency on `"อนุมัติแล้ว"` exists. Either way the drift (`"ไม่อนุมัติ"`) is killed and the two rejections are sharpened — the operator-visible requirement.
- **Sequencing:** T1 must land first (T2 imports its predicate). T3 and T4 are independent of each other and of T2; all four share `page.tsx`, so serialize within this one lane (do not parallelize — same-file edits).
