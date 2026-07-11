# Spec 300 — SA delivery receive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: load `ship-unit` and run each task through its gates (lane claim already held: `spec300-sa-delivery-receive`; TDD RED-first; real-browser verify; fresh-eyes review; ship). Steps use checkbox (`- [ ]`) tracking.

**Goal:** Give the overwhelmed SA a "today" lens on incoming deliveries and one receive card that shows the (already-automatic) store receipt and captures the paper receipt in the same place.

**Architecture:** Two code-only units. U1 adds a pure incoming-delivery lens (today/on-route/all) over the existing spec-137 `กำลังจัดส่ง` band on `/requests`. U2 reorganises the `/requests/[requestId]` receive UI: merge the delivery-photo card and the ใบส่งของ/ใบเสร็จ section into one `รับของ` card, and add a read-only "✓ รับเข้าคลังแล้ว" indicator driven by the existing spec-195-P3 auto-receipt. No server action, no RPC, no migration.

**Tech Stack:** Next.js 16 App Router (Server Components), TypeScript strict, Vitest, Tailwind + field-first tokens, Thai UI copy.

## Global Constraints

- **No schema / no RPC / no server action** — accept-to-store is the existing `purchase_requests_stock_in_on_receive` trigger (spec 195 P3). Do not add a receive path.
- **TDD, RED first** — the pure helper's failing test exists and is seen to fail before implementation (CLAUDE.md).
- **Thai user-facing strings go through `src/lib/i18n/labels.ts`** (UI-term SSOT) — no inline Thai literals in components for the new labels.
- **Field-first tokens** — reuse `src/lib/ui/classes.ts` chip/card classes; no raw Tailwind palette.
- **Server Components by default**; the receive uploaders are already `'use client'` islands — do not add new client components.
- Reuse `DeliveryPhotoUploader` and `InvoiceUploader` verbatim — only their placement changes.

---

## Task 1: Incoming-delivery lens (pure helper + labels)

The testable core of U1: given the incoming (`purchased`/`on_route`) rows and a lens, return the filtered rows. Pure → unit-tested, no React, no query.

**Files:**
- Modify: `src/lib/purchasing/request-bands.ts` (append the lens type, parser, and filter next to the existing band helpers)
- Modify: `src/lib/i18n/labels.ts` (add the three chip labels)
- Test: `tests/unit/request-incoming-lens.test.ts` (create)

**Interfaces:**
- Produces:
  - `type IncomingLens = "today" | "onroute" | "all"`
  - `const INCOMING_LENSES: ReadonlyArray<IncomingLens>`
  - `parseIncomingLens(value: string | null | undefined): IncomingLens` (default `"today"`)
  - `filterIncomingLens<T extends { status: PurchaseRequestStatus; eta?: string | null }>(items: ReadonlyArray<T>, lens: IncomingLens, todayIso: string | null): T[]`
  - `INCOMING_LENS_LABEL: Record<IncomingLens, string>` (in labels.ts)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/request-incoming-lens.test.ts
import { describe, it, expect } from "vitest";
import { filterIncomingLens, parseIncomingLens } from "@/lib/purchasing/request-bands";

const row = (status: string, eta: string | null) => ({ status, eta }) as never;
const TODAY = "2026-07-12";

describe("parseIncomingLens", () => {
  it("defaults to today for unknown/empty", () => {
    expect(parseIncomingLens(null)).toBe("today");
    expect(parseIncomingLens("garbage")).toBe("today");
  });
  it("accepts the known lenses", () => {
    expect(parseIncomingLens("onroute")).toBe("onroute");
    expect(parseIncomingLens("all")).toBe("all");
  });
});

describe("filterIncomingLens", () => {
  it("today = due-or-overdue OR no ETA (any incoming status)", () => {
    const items = [
      row("on_route", "2026-07-11"), // overdue → in
      row("purchased", "2026-07-12"), // today → in
      row("on_route", "2026-07-13"), // future → out
      row("purchased", null), // unknown ETA → in
    ];
    const kept = filterIncomingLens(items, "today", TODAY);
    expect(kept).toHaveLength(3);
    expect(kept).not.toContainEqual(row("on_route", "2026-07-13"));
  });
  it("onroute = only on_route status", () => {
    const items = [row("on_route", "2026-07-20"), row("purchased", "2026-07-11")];
    const kept = filterIncomingLens(items, "onroute", TODAY);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.status).toBe("on_route");
  });
  it("all = every incoming row unchanged", () => {
    const items = [row("on_route", "2026-07-20"), row("purchased", null)];
    expect(filterIncomingLens(items, "all", TODAY)).toHaveLength(2);
  });
  it("today with null todayIso keeps only no-ETA rows (no false 'due')", () => {
    const items = [row("on_route", "2026-07-11"), row("purchased", null)];
    const kept = filterIncomingLens(items, "today", null);
    expect(kept).toEqual([row("purchased", null)]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`filterIncomingLens`/`parseIncomingLens` not exported)

Run: `pnpm exec vitest run tests/unit/request-incoming-lens.test.ts`
Expected: FAIL — "does not provide an export named 'filterIncomingLens'".

- [ ] **Step 3: Implement in `request-bands.ts`** (append after `groupRequestsByBand`)

```ts
// Spec 300 U1 — a delivery lens over the incoming (in_transit) band. Pure.
export type IncomingLens = "today" | "onroute" | "all";
export const INCOMING_LENSES: ReadonlyArray<IncomingLens> = ["today", "onroute", "all"];

export function parseIncomingLens(value: string | null | undefined): IncomingLens {
  return value === "onroute" || value === "all" ? value : "today";
}

// today = due-or-overdue (eta <= todayIso) OR unknown ETA (eta null) — the SA's real
// receive pile. onroute = the shipped subset. all = every incoming row. String compare
// is correct for YYYY-MM-DD. A null todayIso can never mark a row "due" → only null-eta
// rows survive "today" (no false positives).
export function filterIncomingLens<T extends { status: PurchaseRequestStatus; eta?: string | null }>(
  items: ReadonlyArray<T>,
  lens: IncomingLens,
  todayIso: string | null,
): T[] {
  if (lens === "all") return [...items];
  if (lens === "onroute") return items.filter((i) => i.status === "on_route");
  return items.filter((i) => i.eta == null || (todayIso != null && i.eta <= todayIso));
}
```

- [ ] **Step 4: Add labels in `labels.ts`** (find the purchasing/worklist label group; add)

```ts
import type { IncomingLens } from "@/lib/purchasing/request-bands";
export const INCOMING_LENS_LABEL: Record<IncomingLens, string> = {
  today: "วันนี้",
  onroute: "กำลังมา",
  all: "ทั้งหมด",
};
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm exec vitest run tests/unit/request-incoming-lens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/purchasing/request-bands.ts src/lib/i18n/labels.ts tests/unit/request-incoming-lens.test.ts
git commit -m "feat(requests): spec 300 U1 — incoming-delivery lens helper (today/onroute/all)"
```

---

## Task 2: Wire the lens into the SA worklist

Render the lens chips and apply the filter to the `กำลังจัดส่ง` (`in_transit`) band on `/requests`. Server Component change only.

**Files:**
- Modify: `src/app/requests/page.tsx` (param parse near L121; filter the in_transit group after L219; render chips near the view chips at L494–503)

**Interfaces:**
- Consumes: `parseIncomingLens`, `filterIncomingLens`, `INCOMING_LENSES`, `INCOMING_LENS_LABEL`, and the existing `requestBands` (from `groupRequestsByBand`, L219) + `today`.

- [ ] **Step 1: Parse the param** — in the `searchParams` block (alongside the spec-138 `band` parse, ~L121):

```ts
const incomingLens = parseIncomingLens(singleParam(sp.incoming));
```
(Add `incoming?: string | string[]` to the `searchParams` type near L87, and `import { parseIncomingLens, filterIncomingLens, INCOMING_LENSES } from "@/lib/purchasing/request-bands"` + `INCOMING_LENS_LABEL` from labels.)

- [ ] **Step 2: Apply the lens to the incoming band** — right after `const requestBands = groupRequestsByBand(myRequests, requestView, today);` (L219), for the SITE view only:

```ts
// Spec 300 U1: the delivery lens narrows only the incoming (in_transit) band.
const siteBands = requestBands
  .map((g) =>
    g.band === "in_transit" ? { ...g, items: filterIncomingLens(g.items, incomingLens, today) } : g,
  )
  .filter((g) => g.band !== "in_transit" || g.items.length > 0);
```
Render `siteBands` where `requestBands` was previously mapped in the `!isProcurement` branch. (Grep the `requestBands.map(` render site and swap to `siteBands`.)

- [ ] **Step 3: Render the chips** — inside the `!isProcurement` block near the view chips (L494), add a chip row (link-based, preserves `view`/`mine`):

```tsx
{/* Spec 300 U1: delivery lens over the incoming band */}
<div className="flex gap-2" role="group" aria-label="ตัวกรองการจัดส่ง">
  {INCOMING_LENSES.map((lens) => {
    const params = new URLSearchParams(currentSearchParams);
    params.set("incoming", lens);
    const active = lens === incomingLens;
    return (
      <Link key={lens} href={`/requests?${params.toString()}`} className={active ? CHIP_ACTIVE : CHIP_IDLE}>
        {INCOMING_LENS_LABEL[lens]}
      </Link>
    );
  })}
</div>
```
Use the same chip class constants the view segmented control already uses (grep the L494 render for the exact `CHIP_*`/class strings and mirror them; do not invent new classes). If a `currentSearchParams` string isn't already in scope, build it from the parsed `sp`.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Real-flow verify (browser, dev-preview SA)** — memory `dev-preview-login`. Start dev server on this branch, sign in as an SA, open `/requests`: confirm the chips render, `วันนี้` is default, switching to `กำลังมา` shows only `on_route`, `ทั้งหมด` shows all incoming. Zero console errors. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/app/requests/page.tsx
git commit -m "feat(requests): spec 300 U1 — delivery lens chips on the SA worklist"
```

---

## Task 3: "รับเข้าคลังแล้ว" indicator on the receive view

A read-only signal that the auto-receipt fired (goods in store). Derive it from the PR being `delivered` + WP-less (the trigger's exact condition) — no new query needed; the detail page already loads the PR + its status.

**Files:**
- Modify: `src/app/requests/[requestId]/page.tsx` (the `การรับของ` card, opens L469)
- Modify: `src/lib/i18n/labels.ts` (the confirmation string)

**Interfaces:**
- Consumes: `request.status`, `request.work_package_id` (already in scope on the detail page).

- [ ] **Step 1: Add the label**

```ts
export const RECEIVED_INTO_STORE_LABEL = "✓ รับเข้าคลังแล้ว";
export const RECEIVED_INTO_STORE_HINT = "รูปยืนยันการรับของบันทึกของเข้าคลังอัตโนมัติ";
```

- [ ] **Step 2: Compute the flag** — near the other detail-page derivations (~L104–130):

```ts
// Spec 300 U2 / spec 195 P3: a delivered store-bound (WP-less) PR has its stock_receipt
// auto-booked. Show the SA the goods landed in the store.
const receivedIntoStore = status === "delivered" && request.work_package_id == null;
```

- [ ] **Step 3: Render it inside the `การรับของ` card** (L469 block, above the `DeliveryPhotoUploader`):

```tsx
{receivedIntoStore ? (
  <p className="text-ok text-xs font-medium" role="status">
    {RECEIVED_INTO_STORE_LABEL}
    <span className="text-ink-secondary ml-1 font-normal">{RECEIVED_INTO_STORE_HINT}</span>
  </p>
) : null}
```
(Use the repo's success token class — grep `text-ok`/the design-doctrine success color; mirror an existing "done" badge rather than inventing one.)

- [ ] **Step 4: Typecheck + test**

Run: `pnpm typecheck && pnpm test`
Expected: clean (no unit surface; guards must stay green).

- [ ] **Step 5: Commit**

```bash
git add "src/app/requests/[requestId]/page.tsx" src/lib/i18n/labels.ts
git commit -m "feat(requests): spec 300 U2 — received-into-store indicator on the receive card"
```

---

## Task 4: Co-locate the ใบส่งของ/ใบเสร็จ photo in the receive card

Move the receipt-paper uploader into the `การรับของ` card at the receive moment. The full "เอกสาร (ใบส่งของ / ใบเสร็จ)" gallery section (L552–607) stays for viewing history; only the **uploader affordance** (and a short prompt) is surfaced in the receive card so SA captures the paper without scrolling.

**Files:**
- Modify: `src/app/requests/[requestId]/page.tsx`

**Interfaces:**
- Consumes: `InvoiceUploader` (already imported, L59), `request.id`, `request.project_id`.

- [ ] **Step 1: Add the receipt uploader inside the `การรับของ` card** — in the L469 block, after the `DeliveryPhotoUploader` (L503), gated to the same receive window:

```tsx
{/* Spec 300 U2: capture the paper receipt at the receive moment */}
<div className="border-edge border-t pt-2">
  <p className="text-ink-secondary text-xs font-medium">{RECEIPT_PAPER_PROMPT}</p>
  <InvoiceUploader purchaseRequestId={request.id} projectId={request.project_id} />
</div>
```
Add `export const RECEIPT_PAPER_PROMPT = "ใบส่งของ / ใบเสร็จ (ถ้ามากับของ)"` in labels.ts.

- [ ] **Step 2: De-duplicate** — the standalone "เอกสาร (ใบส่งของ / ใบเสร็จ)" section (L552) also renders an `InvoiceUploader` (L604) for `purchased`/`site_purchased` (pre-delivery) states. Keep that section's **gallery** but drop its uploader ONLY when the receive card already shows one (i.e., when `status` is `on_route`/`delivered`), so the button isn't duplicated. Gate L604:

```tsx
{status !== "on_route" && status !== "delivered" ? (
  <InvoiceUploader purchaseRequestId={request.id} projectId={request.project_id} />
) : null}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Real-flow verify (browser, dev-preview SA)** — open a store-bound `on_route` PR: the `รับของ` card shows the delivery-photo button AND the receipt-paper uploader; take the delivery photo → card flips to `✓ รับเข้าคลังแล้ว`; upload a receipt image → it lands (post-#456). Confirm via live DB that a `stock_receipt` exists for that PR. Zero console errors. Screenshot before/after.

- [ ] **Step 5: Commit + add the spec index row**

```bash
# add the 300 row to docs/feature-specs/README.md (before the "Absent spec numbers" footer)
git add "src/app/requests/[requestId]/page.tsx" src/lib/i18n/labels.ts docs/feature-specs/README.md
git commit -m "feat(requests): spec 300 U2 — receipt photo co-located in the receive card"
```

---

## Self-Review

- **Spec coverage:** U1 today/on-route/all lens → Tasks 1–2. U2 unified card = received-into-store indicator (Task 3) + receipt photo co-location (Task 4). "No receive action" honored — no server action/RPC/migration in any task. ✓
- **Placeholder scan:** the two "grep the exact class/render site and mirror" notes (Task 2 Step 3, Task 3 Step 3) are deliberate — the plan must not invent design-token class names it hasn't read; the implementer reads the live constant. Every code block is real.
- **Type consistency:** `IncomingLens`, `filterIncomingLens`, `parseIncomingLens`, `INCOMING_LENSES`, `INCOMING_LENS_LABEL` used identically across Tasks 1–2. `receivedIntoStore`/`RECEIVED_INTO_STORE_*` consistent Tasks 3. `RECEIPT_PAPER_PROMPT` Task 4.

## Execution note

Tasks 1–2 (U1) and Tasks 3–4 (U2) are independent (different files: `request-bands.ts`/`page.tsx` vs `[requestId]/page.tsx`) and could ship as two separate PRs. Both are code-only → auto-merge on green. `src/lib/i18n/labels.ts` is shared-SSOT (touched by both U1 and U2) — serialize the two label edits or rebase.
