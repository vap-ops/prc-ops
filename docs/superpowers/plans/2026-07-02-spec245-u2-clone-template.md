# Spec 245 U2 — Clone Ordering-Plan Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a PM/super_admin/project_director/procurement user clone one of the two global ordering-plan templates ("TFM 16m" / "TFM 20m") into a fresh draft supply plan for a project, pre-filled with the template's lines (whole-project, no WP).

**Architecture:** A pure mapping helper turns a template's `{catalog_item_id, qty, note}` rows into the bulk-add RPC's line-payload shape. A new server action `cloneSupplyPlanTemplate` composes three EXISTING RPCs/reads — `create_supply_plan` (always fresh, spec 189), a plain `select` on `supply_plan_lines` (permitted by spec 245 U1's RLS branch), and `add_supply_plan_lines` (the atomic bulk RPC) — zero new RPCs. A new client component `CloneTemplateButton` (sibling of the existing `NewPlanButton`) picks a template and triggers the clone, then navigates to `?plan=<newPlanId>` exactly like `NewPlanButton` does today. The page loads the 2 template rows server-side and passes them down.

**Tech Stack:** Next.js 16 App Router (Server Component page + Client Component button), Supabase (`@supabase/supabase-js` RPC calls via the existing `getActionUser()`/`server-only` action pattern), Vitest + Testing Library for unit tests.

## Global Constraints

- Code-only unit — **no new migration, no schema/RLS change** (U1 already shipped the RLS branch and RPC fix this depends on).
- MUST use `add_supply_plan_lines` (the bulk RPC) — NEVER `add_supply_plan_line` (singular), which still carries the pre-U1 null-check bug against a template (spec 245 §5/§7, flagged by U1's final reviewer).
- Cloned lines always land whole-project: `work_package_id = null` (spec 245 D5) — no WP matching logic of any kind.
- Following this codebase's established convention (verified against `createPlan`/`bulkAddPlanLines`/`deletePlan` in the same file — none have a dedicated unit test, because they are thin `server-only` RPC wrappers requiring a real Supabase session; correctness is covered by `pnpm db:test` + e2e instead): the new server action itself is **not** unit tested. Only the **pure mapping helper** and the **new UI component** get unit tests, per spec 245 §7 ("its pure mapping helper (unit-tested…)").
- Thai UI copy only for user-facing strings, matching the existing style in `new-plan-button.tsx` / `actions.ts`.
- `pnpm lint && pnpm typecheck && pnpm test` must pass before shipping.

---

## File Structure

- **Create** `src/lib/supply-plan/clone-template.ts` — pure mapping helper `mapTemplateLinesToClonePayload`. No side effects, no Supabase import — trivially unit-testable.
- **Create** `tests/unit/supply-plan-clone-template.test.ts` — unit tests for the helper above.
- **Modify** `src/app/projects/[projectId]/supply-plan/actions.ts` — add `cloneSupplyPlanTemplate` server action, using the new helper.
- **Create** `src/components/features/supply-plan/clone-template-button.tsx` — the UI entry point (client component), a sibling of `new-plan-button.tsx`, following its exact structure (useTransition + router.push + INLINE_ERROR).
- **Create** `tests/unit/supply-plan-clone-template-button.test.tsx` — component test, following `supply-plan-new-button.test.tsx`'s mocking pattern exactly.
- **Modify** `src/app/projects/[projectId]/supply-plan/page.tsx` — load the 2 `is_template=true` rows, render `CloneTemplateButton` next to `NewPlanButton`.

---

### Task 1: Pure mapping helper

**Files:**

- Create: `src/lib/supply-plan/clone-template.ts`
- Test: `tests/unit/supply-plan-clone-template.test.ts`

**Interfaces:**

- Produces: `TemplateLine = { catalogItemId: string; qty: number; note: string | null }`, `ClonePayloadLine = { catalogItemId: string; workPackageId: null; qty: number; note: string }`, `mapTemplateLinesToClonePayload(lines: TemplateLine[]): ClonePayloadLine[]` — consumed by Task 2's server action.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/supply-plan-clone-template.test.ts
import { describe, it, expect } from "vitest";
import {
  mapTemplateLinesToClonePayload,
  type TemplateLine,
} from "@/lib/supply-plan/clone-template";

// Spec 245 U2 — a template's plan lines map 1:1 to the bulk-add RPC's line
// shape. Cloned lines always land whole-project (workPackageId: null, D5).
describe("mapTemplateLinesToClonePayload", () => {
  it("maps catalogItemId and qty through unchanged", () => {
    const lines: TemplateLine[] = [{ catalogItemId: "item-1", qty: 12, note: "หมายเหตุ" }];
    expect(mapTemplateLinesToClonePayload(lines)).toEqual([
      { catalogItemId: "item-1", workPackageId: null, qty: 12, note: "หมายเหตุ" },
    ]);
  });

  it("always sets workPackageId to null", () => {
    const lines: TemplateLine[] = [{ catalogItemId: "item-1", qty: 1, note: null }];
    expect(mapTemplateLinesToClonePayload(lines)[0]?.workPackageId).toBeNull();
  });

  it("defaults a null note to an empty string", () => {
    const lines: TemplateLine[] = [{ catalogItemId: "item-1", qty: 1, note: null }];
    expect(mapTemplateLinesToClonePayload(lines)[0]?.note).toBe("");
  });

  it("maps multiple lines preserving order", () => {
    const lines: TemplateLine[] = [
      { catalogItemId: "a", qty: 1, note: null },
      { catalogItemId: "b", qty: 2, note: "x" },
    ];
    expect(mapTemplateLinesToClonePayload(lines).map((l) => l.catalogItemId)).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty template", () => {
    expect(mapTemplateLinesToClonePayload([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/supply-plan-clone-template.test.ts`
Expected: FAIL — `Cannot find module '@/lib/supply-plan/clone-template'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/supply-plan/clone-template.ts
// Spec 245 U2 — pure mapping helper: a template's plan lines → the payload
// shape add_supply_plan_lines (the bulk RPC) expects. Cloned lines always land
// whole-project (workPackageId: null, D5) — WP allocation happens afterward via
// the existing multi-WP fan-out (spec 222).

export type TemplateLine = {
  catalogItemId: string;
  qty: number;
  note: string | null;
};

export type ClonePayloadLine = {
  catalogItemId: string;
  workPackageId: null;
  qty: number;
  note: string;
};

export function mapTemplateLinesToClonePayload(lines: TemplateLine[]): ClonePayloadLine[] {
  return lines.map((l) => ({
    catalogItemId: l.catalogItemId,
    workPackageId: null,
    qty: l.qty,
    note: l.note ?? "",
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/supply-plan-clone-template.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add src/lib/supply-plan/clone-template.ts tests/unit/supply-plan-clone-template.test.ts
git commit -m "feat(supply-plan): pure template-line-to-clone-payload mapper (spec 245 U2)"
```

---

### Task 2: `cloneSupplyPlanTemplate` server action

**Files:**

- Modify: `src/app/projects/[projectId]/supply-plan/actions.ts`

**Interfaces:**

- Consumes: `mapTemplateLinesToClonePayload` from Task 1 (`@/lib/supply-plan/clone-template`); existing `SupplyPlanResult`, `FAILED`, `NO_PERMISSION`, `getActionUser`, `NOT_SIGNED_IN`, `supplyPlanHref`, `UUID_REGEX`, `revalidatePath` already imported/defined in this file.
- Produces: `export async function cloneSupplyPlanTemplate(input: { templateId: string; projectId: string }): Promise<SupplyPlanResult & { planId?: string }>` — consumed by Task 3's `CloneTemplateButton`.

No dedicated unit test for this task (see Global Constraints — matches this file's existing convention for `createPlan`/`bulkAddPlanLines`/`deletePlan`). Verification is `pnpm typecheck` + `pnpm lint` (this task is exercised live via the U4/manual QA pass and existing `pnpm db:test` coverage of the underlying RPCs, unchanged here).

- [ ] **Step 1: Add the import**

At the top of `src/app/projects/[projectId]/supply-plan/actions.ts`, alongside the existing imports:

```typescript
import { mapTemplateLinesToClonePayload } from "@/lib/supply-plan/clone-template";
```

- [ ] **Step 2: Add the server action**

Insert after `createPlan` (before the `deletePlan` comment block), in `src/app/projects/[projectId]/supply-plan/actions.ts`:

```typescript
// Spec 245 U2 — clone a global template (is_template=true) into a fresh draft
// plan for a project. Zero new RPCs: create_supply_plan (always fresh, spec
// 189) + a plain select of the template's lines (permitted by the spec 245 U1
// RLS branch) + add_supply_plan_lines (the ATOMIC bulk RPC — never the
// singular add_supply_plan_line, which still carries the pre-U1 null-check bug
// against a template). If the add step fails, the fresh plan from step 1 is
// left behind as a harmless empty draft (spec 245 §5) — not auto-deleted.
export async function cloneSupplyPlanTemplate(input: {
  templateId: string;
  projectId: string;
}): Promise<SupplyPlanResult & { planId?: string }> {
  if (!UUID_REGEX.test(input.templateId) || !UUID_REGEX.test(input.projectId)) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data: planId, error: createError } = await supabase.rpc("create_supply_plan", {
    p_project_id: input.projectId,
  });
  if (createError || !planId) {
    if (createError?.code === "42501") return { ok: false, error: NO_PERMISSION };
    return { ok: false, error: FAILED };
  }

  const { data: templateLines, error: readError } = await supabase
    .from("supply_plan_lines")
    .select("catalog_item_id, qty, note")
    .eq("supply_plan_id", input.templateId);
  if (readError) return { ok: false, error: FAILED };

  if (!templateLines || templateLines.length === 0) {
    revalidatePath(supplyPlanHref(input.projectId));
    return { ok: true, planId };
  }

  const payload = mapTemplateLinesToClonePayload(
    templateLines.map((l) => ({
      catalogItemId: l.catalog_item_id,
      qty: Number(l.qty),
      note: l.note,
    })),
  );

  const { error: addError } = await supabase.rpc("add_supply_plan_lines", {
    p_plan_id: planId,
    p_lines: payload.map((l) => ({
      catalog_item_id: l.catalogItemId,
      work_package_id: l.workPackageId,
      qty: l.qty,
      note: l.note,
    })),
  });
  if (addError) {
    if (addError.code === "42501") return { ok: false, error: NO_PERMISSION };
    return { ok: false, error: FAILED };
  }

  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true, planId };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors (confirms the RPC names/columns typecheck against `database.types.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/app/projects/[projectId]/supply-plan/actions.ts
git commit -m "feat(supply-plan): cloneSupplyPlanTemplate server action (spec 245 U2)"
```

---

### Task 3: `CloneTemplateButton` UI component

**Files:**

- Create: `src/components/features/supply-plan/clone-template-button.tsx`
- Test: `tests/unit/supply-plan-clone-template-button.test.tsx`

**Interfaces:**

- Consumes: `cloneSupplyPlanTemplate` from Task 2 (`@/app/projects/[projectId]/supply-plan/actions`); `BUTTON_SECONDARY`, `INLINE_ERROR` from `@/lib/ui/classes`.
- Produces: `export type TemplatePick = { id: string; name: string }`, `export function CloneTemplateButton({ projectId, templates }: { projectId: string; templates: TemplatePick[] })` — consumed by Task 4's page wiring.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/supply-plan-clone-template-button.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Spec 245 U2 — picking a template and clicking clones it into a fresh plan,
// then navigates to it (mirrors NewPlanButton's ?plan=<id> pattern).
const { mockClone, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockClone: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("@/app/projects/[projectId]/supply-plan/actions", () => ({
  cloneSupplyPlanTemplate: mockClone,
}));

import { CloneTemplateButton } from "@/components/features/supply-plan/clone-template-button";

beforeEach(() => {
  mockClone.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
});

const templates = [
  { id: "t1", name: "TFM 16m" },
  { id: "t2", name: "TFM 20m" },
];

describe("CloneTemplateButton", () => {
  it("clones the selected template then navigates to ?plan=<id>", async () => {
    mockClone.mockResolvedValue({ ok: true, planId: "newp" });
    render(<CloneTemplateButton projectId="p1" templates={templates} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t2" } });
    fireEvent.click(screen.getByRole("button", { name: "ใช้เทมเพลตนี้" }));
    await waitFor(() =>
      expect(mockClone).toHaveBeenCalledWith({ templateId: "t2", projectId: "p1" }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("?plan=newp"));
  });

  it("shows an error and does not navigate when cloning fails", async () => {
    mockClone.mockResolvedValue({ ok: false, error: "สร้างไม่สำเร็จ" });
    render(<CloneTemplateButton projectId="p1" templates={templates} />);
    fireEvent.click(screen.getByRole("button", { name: "ใช้เทมเพลตนี้" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("สร้างไม่สำเร็จ"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("renders nothing when there are no templates", () => {
    const { container } = render(<CloneTemplateButton projectId="p1" templates={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/supply-plan-clone-template-button.test.tsx`
Expected: FAIL — `Cannot find module '@/components/features/supply-plan/clone-template-button'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/components/features/supply-plan/clone-template-button.tsx
"use client";

// Spec 245 U2 — clone a global ordering-plan template into a fresh draft plan
// for this project, then navigate to it (mirrors NewPlanButton's ?plan=<id>
// pattern). 'use client' is required: local select-state + router navigation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { cloneSupplyPlanTemplate } from "@/app/projects/[projectId]/supply-plan/actions";

export type TemplatePick = { id: string; name: string };

export function CloneTemplateButton({
  projectId,
  templates,
}: {
  projectId: string;
  templates: TemplatePick[];
}) {
  const router = useRouter();
  const firstId = templates[0]?.id ?? "";
  const [templateId, setTemplateId] = useState(firstId);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (templates.length === 0) return null;

  function handle() {
    setError(null);
    start(async () => {
      const result = await cloneSupplyPlanTemplate({ templateId, projectId });
      if (!result.ok || !result.planId) {
        setError(result.ok ? "สร้างแผนจากเทมเพลตไม่สำเร็จ" : result.error);
        return;
      }
      router.push(`?plan=${result.planId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="rounded-control border-edge bg-card text-ink text-body border px-3 py-2"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handle}
          disabled={pending}
          className={`${BUTTON_SECONDARY} inline-flex items-center gap-1`}
        >
          <Copy aria-hidden className="size-4" /> {pending ? "กำลังสร้าง…" : "ใช้เทมเพลตนี้"}
        </button>
      </div>
      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/supply-plan-clone-template-button.test.tsx`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/components/features/supply-plan/clone-template-button.tsx tests/unit/supply-plan-clone-template-button.test.tsx
git commit -m "feat(supply-plan): CloneTemplateButton UI entry point (spec 245 U2)"
```

---

### Task 4: Wire into the supply-plan page

**Files:**

- Modify: `src/app/projects/[projectId]/supply-plan/page.tsx`

**Interfaces:**

- Consumes: `CloneTemplateButton`, `TemplatePick` from Task 3 (`@/components/features/supply-plan/clone-template-button`).

- [ ] **Step 1: Add the import**

In `src/app/projects/[projectId]/supply-plan/page.tsx`, alongside the existing `NewPlanButton` import (after line 32):

```typescript
import {
  CloneTemplateButton,
  type TemplatePick,
} from "@/components/features/supply-plan/clone-template-button";
```

- [ ] **Step 2: Load the template rows**

After the existing plan-rows query block (after line 82, right before `const planIds = plans.map(...)` on line 84), add:

```typescript
// Spec 245 U2 — the 2 global templates (is_template=true, project_id=null),
// readable by the same write-tier per the spec 245 U1 RLS branch.
const { data: templateRows } = await supabase
  .from("supply_plans")
  .select("id, name")
  .eq("is_template", true)
  .order("name", { ascending: true });
const templates: TemplatePick[] = (templateRows ?? []).map((t) => ({
  id: t.id,
  name: t.name ?? "เทมเพลต",
}));
```

- [ ] **Step 3: Render the button next to NewPlanButton**

Replace this block (around line 244-247):

```typescript
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-ink text-body font-semibold">แผนทั้งหมด ({planItems.length})</h2>
          <NewPlanButton projectId={project.id} />
        </div>
```

with:

```typescript
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-ink text-body font-semibold">แผนทั้งหมด ({planItems.length})</h2>
          <div className="flex flex-wrap items-center gap-3">
            <CloneTemplateButton projectId={project.id} templates={templates} />
            <NewPlanButton projectId={project.id} />
          </div>
        </div>
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Full test run**

Run: `pnpm test`
Expected: all pass, including the 2 new test files from Tasks 1 and 3.

- [ ] **Step 6: Commit**

```bash
git add src/app/projects/[projectId]/supply-plan/page.tsx
git commit -m "feat(supply-plan): wire CloneTemplateButton into the supply-plan page (spec 245 U2)"
```

---

## Verification Checklist (spec 245 §7, U2 scope)

- [ ] `cloneSupplyPlanTemplate` calls `create_supply_plan` then `add_supply_plan_lines` (bulk) — never `add_supply_plan_line` (singular).
- [ ] Cloned lines always carry `work_package_id: null`.
- [ ] The pure mapping helper has its own unit test (Task 1).
- [ ] The clone entry point renders next to the existing "new plan" button and navigates to `?plan=<newPlanId>` on success (Task 3/4).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` all green.
- [ ] No migration files touched. No changes to `submit_supply_plan`/`approve`/`reject`/`reopen` (out of scope, D2/D8).
