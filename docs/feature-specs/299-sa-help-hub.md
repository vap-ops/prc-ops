# Spec 299 — SA help hub (in-app, text-first manual)

**Status:** 🎨 DESIGN (brainstormed + approved by operator 2026-07-11).
**Type:** in-app help — a re-readable, text-first manual for the non-technical site_admin, one card per day-to-day task.
**Class:** code-only, low-risk (new SA route + static content + one home-screen entry; no schema, no money/auth/RLS, no shared enum) ⇒ auto-merge on green.
**Parent:** SA surface (spec 279/282/277 SA home + crew) · the **เพิ่มช่างใหม่** card documents spec 298's onboarding front door.

The site_admin is a non-technical field lead working on a phone. There is **no in-app help of any kind today** (greenfield — no `/help` route, no tour/coachmark infra, grep-confirmed 2026-07-11). This spec adds a plain, re-readable **help hub** at `/sa/help`: one card per core SA task, each expanding to numbered Thai steps. It is a **reference the SA returns to when stuck**, not a one-shot tour — chosen over a coachmark tour (brittle, one-shot, heavy) and over a printable PDF (goes stale, lives outside the app). Text-first: usable copy now, screenshots as a later follow-up.

## Doctrine anchors (read these; they shape the mechanism)

- **`sa-real-usage-photos-2026-07`** — the SA's real day-to-day activity is **photographing work packages**; attendance/muster is the adoption bet. ⇒ the cards are **ordered by daily-use frequency** (photos first), not by onboarding sequence.
- **`field-first-design-system`** — the SA surface uses the `globals.css` token system (raw Tailwind palette banned; enforced by tests). The hub reuses existing card/`PageShell`/`DetailHeader` primitives — no new visual system.
- **`ui-term-consistency-ssot`** — every user-facing term the manual names must match the term the app actually shows (single-source via `src/lib/i18n/labels.ts`). The manual is a place term drift becomes visible; it must track the live labels, not invent copy.
- **`self-governance-doctrine`** / **`sa-custody-doctrine`** — the manual describes what the SA is *allowed* to do (identity + presence + photos); it must not imply money/pay authority the SA doesn't have (ADR 0079).
- Spec **298** — the onboarding front door (`/sa/crew` → "เพิ่มช่างใหม่" sheet, มีมือถือ QR / ไม่มีมือถือ capture). The onboarding card documents this; its copy finalizes **after 298 U2 ships** (see build order).

## What already exists (verified LIVE 2026-07-11)

- **No help/manual/tour anywhere.** No `/help` or `/sa/help` route (`src/app/**/help/**` empty); no coachmark/tour/walkthrough code. This is the first help surface.
- **`/sa` home** (`src/app/sa/page.tsx`) — the SA landing; a grid of action cards. This is where the single **"คู่มือ"** entry goes.
- **SA surfaces the cards describe (live):** `/sa/crew` (roster + the 298 add front door), the muster/attendance flow, the WP-photo flow, the crew roster/progress. Exact routes + labels are gate-checked at build (each card must name the live label, per `ui-term-consistency-ssot`).
- **Chrome primitives:** `PageShell`, `DetailHeader`, the card/`rounded-card border-edge bg-card` idiom (as used across `/sa/*`). Reused as-is.

## The mechanism (what this spec builds)

### 1. The hub route (`/sa/help`)

A single server page at `src/app/sa/help/page.tsx`, gated `requireRole(["site_admin","super_admin"])`, titled **"คู่มือการใช้งาน"**. Body = a vertical list of **task cards**; each card is a titled, tappable **accordion** that expands to its steps in place (no sub-routes — least navigation for a field lead). Each card section carries a stable **anchor id** (e.g. `#photos`, `#muster`, `#add-crew`, `#manage`) so a future per-screen "?" can deep-link (`/sa/help#photos`) without a rebuild.

### 2. The card component

One presentational component `src/components/features/sa/help/help-card.tsx` (client only if the accordion needs local open state; otherwise a native `<details>`/`<summary>` server component — prefer the latter, zero JS). Props: `{ id, title, whenToUse, steps: string[], tip? }`. Renders: the Thai title (tappable), a one-line **"เมื่อไหร่ใช้"**, the numbered steps, and an optional tip. Content is **data**, not markup — the cards are an array of typed objects in `src/lib/sa/help-content.ts` so copy edits never touch layout.

### 3. The content (text-first, authored by CC, operator-reviewed)

`src/lib/sa/help-content.ts` — a typed `HELP_CARDS: HelpCard[]` array. Four cards, **ordered by daily-use frequency**. The step copy below is the **outline the build drafts into polished Thai** from the live flows (each step's wording must match the live label it references):

1. **`photos` — ถ่ายรูปงาน** _(the SA's #1 activity)_
   - เมื่อไหร่ใช้: ทุกครั้งที่งาน (WP) มีความคืบหน้าหรือทำเสร็จ
   - Steps: เปิดโครงการ/งาน → เลือกงาน (WP) ที่ทำ → กดถ่ายรูป → ถ่าย/เลือกรูป → ยืนยันว่ารูปผูกกับงานนั้น
2. **`muster` — เช็คชื่อ (ลงเวลาทำงาน)** _(the adoption bet)_
   - เมื่อไหร่ใช้: ต้นวัน เพื่อบันทึกว่าใครมาทำงานวันนี้
   - Steps: เปิดหน้าเช็คชื่อ → ทำเครื่องหมายมา/ไม่มา รายคน → บันทึก
3. **`add-crew` — เพิ่มช่างใหม่** _(documents the 298 front door — finalize after 298 U2)_
   - เมื่อไหร่ใช้: มีช่างใหม่เข้าทีม
   - Steps: ไปที่ ทีมงาน (`/sa/crew`) → กด "เพิ่มช่างใหม่" → **ช่างมีมือถือ:** ให้สแกน QR แล้วกรอกข้อมูล+บัญชีด้วยตัวเอง / **ไม่มีมือถือ:** กรอกชื่อ–เลขบัตรประชาชน–วันเกิด แล้วถ่ายรูปสมุดบัญชี → เสร็จ
   - Tip (money-gov honesty): เรื่องค่าจ้าง/ระดับ ทีมสำนักงาน (PM) เป็นผู้กำหนด ไม่ใช่หน้าที่ SA
4. **`manage` — จัดการทีม** 
   - เมื่อไหร่ใช้: ดูสมาชิกทีมและสถานะการรับเข้า
   - Steps: เปิด ทีมงาน → ดูสถานะ (รอตรวจ → รอยืนยัน → พร้อม) → ดูทีมหน้างาน

### 4. The home entry

One card on `/sa` home (`src/app/sa/page.tsx`) — **"คู่มือการใช้งาน"** — linking to `/sa/help`. Reuses the existing SA action-card idiom; no new visual pattern. (A per-screen contextual "?" is a documented future enhancement, not built here.)

## Unit plan

| Unit | Scope | Merge gate | Tests (RED-first) |
| ---- | ----- | ---------- | ----------------- |
| **U1 — hub + 3 independent cards + entry** | `src/lib/sa/help-content.ts` (`HelpCard` type + the `photos`/`muster`/`manage` cards); `help-card.tsx`; `src/app/sa/help/page.tsx` (route, role gate, renders `HELP_CARDS`); the `/sa` home "คู่มือ" entry; any labels in `src/lib/i18n/labels.ts`. **Omits the `add-crew` card** (U2, coupled to 298). | Code-only → auto-merge on green. | Vitest/RTL: the page renders a card per `HELP_CARDS` entry with title + steps; each card has its anchor id; the accordion expands; the `/sa` home shows the คู่มือ link; role gate blocks a non-SA. Content test: every card's referenced screen label exists in `labels.ts` (term-consistency guard). |
| **U2 — the onboarding card** _(after 298 U2 ships)_ | Add the `add-crew` card object to `help-content.ts`, its copy matching the **live** 298 front door (มีมือถือ QR / ไม่มีมือถือ capture) + the money-gov tip. | Code-only → auto-merge on green. | Vitest: the `add-crew` card renders both branches + the money-gov tip; its step labels match the live 298 UI labels. |

Build order: **U1 anytime** (independent of 298). **U2 after 298 U2** so the onboarding copy documents the real, shipped front door (not a design that could still shift).

## Design sub-decisions resolved in this spec (do not relitigate)

- **Shape = in-app help hub** (re-readable reference), NOT a coachmark tour (brittle/one-shot/heavy) and NOT a printable PDF (stale/out-of-app). A print/export of the same content is a possible future add-on. (Operator, 2026-07-11.)
- **Text-first.** Plain Thai steps now; screenshots are a later follow-up (they rot as the UI changes and multiply the build). (Operator, 2026-07-11.)
- **Copy authored by CC, operator-reviewed**, drafted from the live flows; every referenced term tracks the live `labels.ts` (`ui-term-consistency-ssot`). (Operator, 2026-07-11.)
- **Cards ordered by daily-use frequency** (photos → muster → add-crew → manage), per `sa-real-usage-photos-2026-07` — not by onboarding sequence.
- **onboard + generate-QR = one card** (`add-crew`), because spec 298 unifies both behind the "เพิ่มช่างใหม่" front door. (Operator, 2026-07-11.)
- **Accordion, no sub-routes** — least navigation for a field lead; anchor ids keep future deep-linking cheap.
- **Content is data** (`help-content.ts` array), not markup — copy edits never touch layout.

## Out of scope

- Per-screen contextual "?" launchers / deep-link buttons on the SA screens (future; the anchor ids are laid now so it's cheap later).
- Screenshots, video, GIFs, or any media (text-first v1).
- A printable/exportable (PDF) rendering of the manual (possible future add-on).
- Help for non-SA roles (PM/procurement/etc.) — this hub is SA-only.
- Any behavior change to the flows the manual describes — this spec only documents them.
- The `add-crew` card content until spec 298 U2 has shipped (U2 here).

## Verification checklist

- **U1:** `pnpm lint && pnpm typecheck && pnpm test` green. Dev-preview (`dev-preview-login`) as a site_admin: `/sa` shows the **"คู่มือการใช้งาน"** entry → `/sa/help` lists the 3 cards; each expands to its steps; anchor deep-link (`/sa/help#muster`) opens the right card; a non-SA session is blocked. Every referenced label matches what the live screen shows. Zero console errors.
- **U2 (after 298 U2):** tests green. Dev-preview: the **เพิ่มช่างใหม่** card describes the real front door (both branches) + the money-gov tip; its wording matches the shipped 298 UI.
- **Whole feature:** `scripts/ship-pr.sh` proves each unit merges clean; fresh-eyes review per unit.
</content>
