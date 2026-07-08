# Site-purchase → Expense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-site self-purchase (ซื้อเอง) unmistakably a _catalog-only, evidence-required expense_, clearly separated from the ask-procurement request (ขอซื้อ), so the two can't be confused.

**Architecture:** No schema/enum change (spec 285 Level A). Keep `purchase_requests` rows with `source='site_purchase'`/`status='site_purchased'`. Enforce requirements at the validator/form layer. Re-scope UI surfaces. Phase-2 (RPC hard-gate, GL account, use_now future) is out of scope.

**Tech Stack:** Next.js 16 App Router (Server Components default), React 19 client components, TypeScript strict, Vitest + Testing Library (jsdom), Field-First design tokens (globals.css; no raw Tailwind palette).

## Global Constraints

- TDD: failing test first, every unit. First message of each unit's implementation is the test.
- No enum change; no migration; no RPC signature change (all Phase 2).
- Requiredness lives in the validator/form layer, never DB `NOT NULL`/`CHECK`.
- Roles unchanged. No touch to `src/lib/auth/**`, RLS, GL, notifications, service-role client.
- User-facing terms via `src/lib/i18n/labels.ts` SSOT; additive, disjoint region.
- Design tokens only (e.g. `text-ink`, `border-edge-strong`, `bg-card`); no raw palette.
- Each unit ends green on `pnpm lint && pnpm typecheck && pnpm test`; ship as its own PR (code-only → auto-merges on green). Per project rule, one unit per session.

---

### Task 1 (U1): Expense form is catalog-only + amount required

**Files:**

- Modify: `src/lib/purchasing/validate-site-purchase.ts` (amount required)
- Modify: `src/components/features/purchasing/self-purchase-form.tsx` (remove free-text mode + use-now toggle; always catalog; require amount)
- Test: `tests/unit/validate-site-purchase.test.ts`, `tests/unit/self-purchase-form.test.tsx`

**Interfaces:**

- Produces: `validateSitePurchase(input)` where `input.amount: number | null`; now returns `{ok:false}` when amount is null/≤0. `ValidatedSitePurchase.amount` narrows to `number`.
- The form calls only `recordSitePurchase` (the attachable path). `sitePurchaseUseNow` import is removed.

- [ ] **Step 1: Failing validator test** — amount is now required.

In `tests/unit/validate-site-purchase.test.ts` add:

```ts
it("rejects a null amount (an expense must have a cost)", () => {
  const r = validateSitePurchase({
    workPackageId: "11111111-1111-4111-8111-111111111111",
    itemDescription: "ปูนถุง",
    quantity: 1,
    unit: "ถุง",
    amount: null,
    reasonCode: "unplanned_miss",
    vatRate: 0,
  });
  expect(r.ok).toBe(false);
});
```

Also update any existing test that asserts a null amount is accepted — flip it to expect `ok:false` (search the file for `amount: null` with `ok).toBe(true)`).

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run tests/unit/validate-site-purchase.test.ts`
Expected: FAIL (null amount currently returns `ok:true`).

- [ ] **Step 3: Make amount required in the validator**

In `validate-site-purchase.ts`, replace the optional-amount block (lines ~60-62):

```ts
if (input.amount === null || !Number.isFinite(input.amount) || input.amount <= 0) {
  return { ok: false, error: "กรุณาระบุจำนวนเงินที่จ่าย" };
}
```

Narrow the interface field `ValidatedSitePurchase.amount` from `number | null` to `number` (drop the `| null` and the "optional" comment).

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm exec vitest run tests/unit/validate-site-purchase.test.ts` → PASS.

- [ ] **Step 5: Failing form test** — catalog-only, amount required, no free-text / no use-now.

In `tests/unit/self-purchase-form.test.tsx` add/adjust:

```tsx
it("has no free-text (พิมพ์เอง) toggle — catalog only", () => {
  render(
    <SelfPurchaseForm
      projectId={PID}
      workPackageId={WID}
      catalogItems={[CATALOG_ITEM]}
      categories={CATS}
    />,
  );
  expect(screen.queryByText("พิมพ์เอง")).toBeNull();
});
it("has no ใช้ที่งานนี้เลย (use-now) toggle", () => {
  render(
    <SelfPurchaseForm
      projectId={PID}
      workPackageId={WID}
      catalogItems={[CATALOG_ITEM]}
      categories={CATS}
    />,
  );
  expect(screen.queryByText(/ใช้ที่งานนี้เลย/)).toBeNull();
});
```

(Reuse existing test fixtures for `CATALOG_ITEM`/`CATS`; if the file previously tested the free-text or use-now branch, delete those cases.)

- [ ] **Step 6: Run — expect FAIL**

Run: `pnpm exec vitest run tests/unit/self-purchase-form.test.tsx` → FAIL (toggle text still present).

- [ ] **Step 7: Rewrite the form — catalog-only, amount required, record-only**

In `self-purchase-form.tsx`:

- Delete `type Mode`, the `mode` state, and the free-text `<input>` branch (item/unit). Render `ScopedCatalogItemPicker` unconditionally.
- Delete `useNow` state, `canUseNow`, `goUseNow`, the use-now `<label>` toggle, the `goUseNow` submit branch, and the `sitePurchaseUseNow` import.
- `selected = catalogItems.find((c) => c.id === catalogItemId) ?? null`.
- In `submit`: guard `if (!selected) { setError("เลือกสินค้าจาก" + CATALOG_LABEL); return; }`; keep the validator call (now amount-required) for the record path; submit label stays `"บันทึกการซื้อ"` (relabelled in U3).
- Empty-catalog guard: `if (catalogItems.length === 0) return <p className="text-meta text-ink-secondary">ยังไม่มีสินค้าใน{CATALOG_LABEL} — เพิ่มก่อนจึงบันทึกค่าใช้จ่ายได้</p>;`

- [ ] **Step 8: Run — expect PASS** (form + validator + full suite)

Run: `pnpm exec vitest run tests/unit/self-purchase-form.test.tsx tests/unit/validate-site-purchase.test.ts` → PASS.
Then `pnpm lint && pnpm typecheck && pnpm test` → all green (fix any caller of `validateSitePurchase` that assumed nullable amount).

- [ ] **Step 9: Commit + ship**

```bash
git add -A && git commit -m "feat(purchasing): expense form is catalog-only + amount required (spec 285 U1)"
bash scripts/ship-pr.sh
```

---

### Task 2 (U2): Expense stays "incomplete" until item photo + accounting doc attached

**Files:**

- Create: `src/lib/purchasing/expense-completeness.ts` (pure helper)
- Modify: `src/components/features/purchasing/self-purchase-form.tsx` (success state requires both)
- Modify: `src/components/features/purchasing/invoice-uploader.tsx` + `item-photo-uploader.tsx` (add `onUploaded?` callback) — read these first to match their state machine
- Test: `tests/unit/expense-completeness.test.ts`, `tests/unit/self-purchase-form.test.tsx`

**Interfaces:**

- Produces: `isExpenseComplete(a: { hasItemPhoto: boolean; hasAccountingDoc: boolean }): boolean` — true only when both. Later surfaced by U3's list badge.
- `ItemPhotoUploader`/`InvoiceUploader` gain `onUploaded?: () => void` fired on a successful upload.

- [ ] **Step 1: Failing helper test**

```ts
import { isExpenseComplete } from "@/lib/purchasing/expense-completeness";
it("complete only when both photo and doc present", () => {
  expect(isExpenseComplete({ hasItemPhoto: true, hasAccountingDoc: true })).toBe(true);
  expect(isExpenseComplete({ hasItemPhoto: true, hasAccountingDoc: false })).toBe(false);
  expect(isExpenseComplete({ hasItemPhoto: false, hasAccountingDoc: false })).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm exec vitest run tests/unit/expense-completeness.test.ts`)
- [ ] **Step 3: Implement helper**

```ts
export function isExpenseComplete(a: {
  hasItemPhoto: boolean;
  hasAccountingDoc: boolean;
}): boolean {
  return a.hasItemPhoto && a.hasAccountingDoc;
}
```

- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Failing form test** — after record, "done" copy appears only once both uploaders report success. Drive via the new `onUploaded` callbacks (read `invoice-uploader.tsx` to see how a success is signalled, then wire `onUploaded`). Assert the success state shows `"ยังไม่สมบูรณ์ — รอรูปสินค้า และเอกสาร"` until both fire.
- [ ] **Step 6: Run → FAIL**
- [ ] **Step 7: Implement** — in the `recordedId` block, track `hasItemPhoto`/`hasAccountingDoc` state set by the uploaders' `onUploaded`; render the incomplete notice until `isExpenseComplete(...)`.
- [ ] **Step 8: Run → PASS**; then `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] **Step 9: Commit + ship** (`feat(purchasing): expense requires item photo + accounting doc (spec 285 U2)`)

---

### Task 3 (U3): Separate + relabel the expense out of the คำขอซื้อ tracker

**Files:**

- Modify: `src/lib/i18n/labels.ts` (add expense terms — additive, disjoint region)
- Modify: `src/components/features/purchasing/self-purchase-section.tsx` (relabel heading/sub-copy; Receipt icon)
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx` (`:542-575`) — split the expense affordance out of the "คำขอซื้อ" tab into its own tab **"ค่าใช้จ่ายหน้างาน"**; the request tab keeps only `PurchaseRequestForm`
- Modify: `src/components/features/purchasing/purchase-request-card.tsx` — a `site_purchased` row shows a distinct **"ค่าใช้จ่าย"** badge (not read as a pending request)
- Test: `tests/unit/self-purchase-section.test.tsx`, plus a card test for the badge

**Interfaces:**

- Produces: `labels.ts` exports `SITE_EXPENSE_HEADING = "บันทึกค่าใช้จ่าย (จ่ายเงินไปแล้ว)"`, `SITE_EXPENSE_TAB_LABEL = "ค่าใช้จ่ายหน้างาน"`, `SITE_EXPENSE_SUBMIT = "บันทึกค่าใช้จ่าย"`, `SITE_EXPENSE_BADGE = "ค่าใช้จ่าย"`. Request affordance keeps `"ขอซื้อ"` wording.

- [ ] **Step 1: Failing section test** — heading is the expense heading, not `"ซื้อเอง"`, and mentions no `"พิมพ์เอง"`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Relabel `self-purchase-section.tsx`** — heading `SITE_EXPENSE_HEADING`, sub-copy "จ่ายเงินไปแล้ว — เลือกจาก{CATALOG_LABEL} แนบรูปสินค้าและใบเสร็จ", a lucide `Receipt` icon. Add the labels to `labels.ts`.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Failing WP-page + card tests** — the expense affordance renders under a separate `"ค่าใช้จ่ายหน้างาน"` tab (not `"คำขอซื้อ"`); a `site_purchased` card shows `SITE_EXPENSE_BADGE`.
- [ ] **Step 6: Run → FAIL**
- [ ] **Step 7: Implement** — in `page.tsx`, move `<SelfPurchaseSection>` into a new tab object `{ key: "expenses", label: SITE_EXPENSE_TAB_LABEL, panel: <SelfPurchaseSection .../> }` inserted right after `purchases`; remove it from the `purchases` panel. In `purchase-request-card.tsx`, when `status === "site_purchased"` render the `SITE_EXPENSE_BADGE` chip.
- [ ] **Step 8: Run → PASS**; then `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] **Step 9: Commit + ship** (`feat(purchasing): split + relabel the site expense out of คำขอซื้อ (spec 285 U3)`)

---

## Self-review

- **Spec coverage:** U1 = catalog-only + amount-required (spec §Design U1); U2 = required evidence (§U2); U3 = separate + relabel + de-commingle (§U3). Phase-2 items explicitly out of scope. ✓
- **Placeholder scan:** U1 fully concrete. U2/U3 name exact files, interfaces, and test intent; the two spots that say "read the file first" (`invoice-uploader` state machine, card internals) are genuine executor reads, not logic left unspecified. ✓
- **Type consistency:** `validateSitePurchase` amount `number|null` in → `ValidatedSitePurchase.amount: number` out; `isExpenseComplete({hasItemPhoto,hasAccountingDoc})`; label constant names reused across U3. ✓
