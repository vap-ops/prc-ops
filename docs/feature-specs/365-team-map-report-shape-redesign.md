# Spec 365 — Team map redesign: mirror the daily report's shape, surface the gaps

**Status:** approved (operator, 2026-07-27 in-chat, with mockups over the visual companion)
**Depends on:** spec 330 (the map itself, `/projects/:id/team`), spec 338 (firm-card identity, button hierarchy — kept), spec 348/#766/#776 (procurement_manager owns this page and everything on it), spec 328 (per-firm QR onboarding poster, kept as a door)
**Schema:** NONE. Code-only — a regrouping + a read-only fix-list layer over existing writes. No new RPCs, no new tables, no new migration.

## Why

Origin: the operator's own daily field reports (25–26 ก.ค. 2569) group people into a shape the page does not — **ทีมช่างภายใน (paid daily by PRC) → ผู้รับเหมาช่วง (subcon firms/trades) → สนับสนุน (store/site-lead/admin)**. The page instead groups staff by role tier and crews/firms/unassigned into one undifferentiated "ทีมช่าง" bucket. That mismatch was not cosmetic: on 2026-07-26 the site ran 5 DC teams against 4 crews in the database, so ทีมป้าสังวาลย์ had no team to be picked into during เช็คชื่อ and her 5 members scattered into whichever team was already open. The redesign makes the page teach the same structure the report already assumes, and puts every currently-detectable disagreement between "what the app knows" and "what the site is actually running" at the top of the screen instead of nowhere.

This spec is a direct sequel to #766/#776 (procurement_manager owns crew management, project membership, and the SA หลัก) — she is now both the audience and the person accountable for what this page shows.

## Gate-checked facts (live DB + code at `origin/main`, 2026-07-27)

- **Bands map onto existing entities, no new storage:**
  - ทีมภายใน = `crews` (+ `crew_members`) — today 4 active crews, sizes 7/6/6/2.
  - ทีมภายนอก = `contractors` (+ `workers.contractor_id`) — ⚠️ **`contractors` carries no `project_id` at all** (verified live — no such column). A firm's presence on THIS project is knowable only through `workers` rows scoped to it, so the band must be scoped by `workers.project_id`, never by the whole 10-row company table. On the pilot project, live-queried by `project_id` regardless of `active`: **only ช่างอวย has ever had a worker here (3, all active)** — the other 9 company-wide contractors (ช่างสุทิน, ช่างโครงหลังคา, ช่างโก, 24 เฮ้าส์ เซอร์วิส, etc.) have **zero rows tied to this project**, active or historical; they are firms working elsewhere, not "unnamed firms on this project." An earlier design pass illustrated several of them as this project's "zero-worker firm" cards from an unscoped company-wide query — **wrong**, caught while writing the implementation plan, corrected here before any code.
  - สนับสนุน = `project_members` — today 11 rows.
- **8 active workers are in neither a crew nor tied to a contractor** (`crew_members.removed_at is null` union `workers.contractor_id`) — the "unassigned" count is a real, always-derivable query.
- **`crews.lead_worker_id` is nullable** — a leadless crew is a real, schema-reachable state (the existing `team-map-view.tsx` empty-state string "ยังไม่ตั้งหัวหน้าทีม — แตะเพื่อเลือก" already handles it) — but **not currently true for any of the 4 live crews**; all four have a lead who is still an active member (verified: จันทร์ เงางาม leads ทีม ช จันทร์, etc.). An earlier mockup illustrated this condition ON ทีม ช จันทร์, which was **factually wrong** and is not carried into this spec — the leadless-crew fix-list item is built for when it happens, not asserted as happening now.
- **ห้องเย็น, ช่างไฟ, แม่บ้าน have zero backing in the database** — not a `contractors` row, not any `workers` row under any contractor. **กระเบื้อง is not a firm at all** — it is เหิน เมืองงาม, an existing ช่างอวย crew member, doing tile work that day; the paper report conflates trade-of-the-day with team identity for a lone worker. Neither case is derivable from `contractors`/`workers` — the page cannot fabricate a card for an entity with no row, and does not attempt to parse the paper report to find them.
- **`/contacts` already has a create-contractor flow** (`create_contractor` action) — the door for "a firm mentioned nowhere in the system" goes there, not to a new inline shortcut.
- **`/team`'s existing per-firm QR onboarding poster (spec 328)** is the self-onboard door for "existing firm, zero currently-active names" — `/team/poster?contractor=<id>&project=<id>` is a standalone, already-built page for exactly one firm, so the door is a plain link, no new component.
- ⚠️ **There is NO manual, phone-free path to create a contractor-tied worker** — checked live and corrected while writing the implementation plan. `/workers`' `AddWorkerForm` has no firm/contractor field at all, and its own file header cites **ADR 0073**: "a ช่าง is a self-sufficient worker, hired directly (no contractor firm)" — this is a deliberate design boundary, not an oversight. The only place `workers.contractor_id` is ever set is the registration-approval flow (`registration-decision.tsx`), which requires the person to have personally scanned a QR and self-registered; `sa_add_project_worker` (the one offline/manual add RPC) takes no contractor parameter. **The original claim that `/workers` already supports a `contractor_id`-preset add was wrong** — building that would need a new RPC param, which is schema-adjacent work outside this spec's "no schema" line. So the zero-worker-firm card offers **QR only**; the real gap (no way to onboard a phoneless contractor-tied worker) is logged as an owed follow-up spec, not built here.
- Team-map-write RPCs (`create_crew`, `add_worker_to_crew`, `remove_worker_from_crew`, `move_worker_between_crews`, `set_crew_lead`, `rename_crew`, `dissolve_crew`) and the `project_members` INSERT/DELETE policies + `set_primary_project_for` all already admit `procurement_manager` (spec 348 §U3, #766, #776) — this spec touches none of those gates.

## Model — three bands, in report order

1. **ทีมภายใน** · caption "จ้างรายวันโดย PRC" · count = active crews. Card = today's crew card (lead band, member chips, `เพิ่มสมาชิก`, `ตั้งเป็นหัวหน้าทีม`, `ย้ายไปทีม`, dissolve — all existing behavior, unchanged). Band header gets `+ ตั้งทีมใหม่` (already exists, just re-homed under the new heading).
2. **ทีมภายนอก · ผู้รับเหมาช่วง** · count = contractors **with at least one `workers` row (active OR inactive) scoped to `project_id` = this project** — never a raw `contractors` table count (see the corrected fact above: that table has no project scoping, so an unscoped count would list firms from other sites entirely). A firm scoped in but with zero currently-ACTIVE workers renders a dashed card with **one door**: `แชร์ QR สมัคร` (a plain link to the existing `/team/poster?contractor=<id>&project=<id>` page) — this is the "had someone here, they left/deactivated, nobody active now" state, not "any company firm with headcount elsewhere." Band header gets a new **`+ เพิ่มผู้รับเหมาช่วง`** action → doors to `/contacts`'s existing create-firm flow (new for this page; not a new flow — a door to one).
3. **สนับสนุน** · count = `project_members`. **One flat list**, no PM-tier/SA-tier sub-grouping (the operator's report already lists these by function — สโตร์, หัวหน้าโครงการ, แอดมิน — not by role category, and collapsing the two former tiers into one matches that without losing any information: each row still shows its role label). `เพิ่มสมาชิก` at the band header; tap a person → `ถอดออกจากทีมโครงการ` / `ตั้งเป็น SA หลัก` (both real since #776).

Today's/tomorrow's plan-assignment layer (currently interleaved with the bands) moves to a **second tab** ("แผนงานวันนี้") on the same page — a full context switch by design (operator's pick over a collapsed-same-scroll alternative), so the structure view and the planning view never compete for the same screen space. The tab label carries a small count of teams still unassigned for the day, so she knows whether to open it without navigating in.

⚠️ **Gap caught while writing the plan, resolved:** picking up a WP from the tray and dropping it "on a team card" today happens in one screen, both visible together — splitting into a tab breaks that unless the tab also renders a drop target. Resolved (operator): the plan tab keeps a **compact name+count list of ทีมภายใน crews only** (no chips, no member actions) purely as `วางที่ทีมนี้` targets; everything else about placing (pick up → tap → assign) stays byte-identical, only the full team-management UI moves out.

## Fix-list — top of the ทีมงาน tab, only when non-empty

Exactly three conditions, each 100% derivable from tables already read on this page — nothing inferred from the paper report:

1. **Unassigned workers**: active workers in no crew and tied to no contractor → `"N คนยังไม่มีทีม"` → tap expands the existing `ยังไม่จัดทีม` pool card in place (there is no separate "add-to-crew sheet" — the pool is already a `TeamMapTeamCard`; expanding it and tapping a chip is the existing assign flow).
2. **Leadless crew**: any active crew with `lead_worker_id is null` → `"ทีม X ยังไม่มีหัวหน้าทีม"` → tap expands that crew's card in place, surfacing the existing "ยังไม่ตั้งหัวหน้าทีม" prompt.
3. **Firm with zero named workers**: a contractor with ≥1 `workers` row (active or inactive) scoped to this `project_id`, but zero currently-active → `"บริษัท X ยังไม่มีรายชื่อ"` → tap expands that firm's card in place (the one-door QR state above). **Live today this fires for none of the 10 company contractors** — same as the leadless-crew condition, built for when it happens rather than illustrated as happening now.

⚠️ **Owed follow-up (out of scope here, needs a new RPC):** there is no manual, phone-free way to onboard a contractor-tied worker — only the QR self-registration path reaches `workers.contractor_id`. A firm whose people have no phones (the ห้องเย็น/แม่บ้าน-shaped case from the operator's own report) has no in-app path at all today. Recorded as a gap for a future spec, not built here.

No fourth condition for "a firm/trade the report names that has no row at all" — that state is invisible to a query and the design deliberately does not try to reconcile free text against the database. The standing `+ เพิ่มผู้รับเหมาช่วง` door is the answer for that case, always available, not conditioned on detecting a gap.

The list renders as a single card above the bands (not per-band, not a persistent banner when empty) — each line a full-width tap target. Order: the unassigned-workers line first (it has no natural card home, so it is the one item that would otherwise be invisible), then one line per leadless crew, then one line per zero-worker firm. Within each band, existing chip/card ordering is unchanged — this spec reorders nothing that already has a stable order.

## Out of scope (listed so review rejects drift)

- Any new RPC, any new table, any migration. Every write this page performs today keeps its exact contract.
- Parsing or importing the paper daily report. This spec makes the APP's own structure legible and self-diagnosing; it does not ingest the report as data.
- A lightweight/bare-name create-contractor shortcut. The door goes to `/contacts`'s existing full flow — a second, thinner path to the same table was explicitly declined.
- Changing what `เช็คชื่อ` (muster) does. This spec only makes the structure it depends on visibly correct beforehand.
- Re-litigating spec 338's firm-card visual identity or button hierarchy — kept as-is, just re-homed under the new band headers.
- Trade/capability display (spec 338 U2/U3) — untouched, rides along on the existing crew card.

## Units

- **U1 — regroup + rename.** Three bands replace today's tiers; ทีมภายใน/ทีมภายนอก/สนับสนุน headers + captions; band-header actions (`+ ตั้งทีมใหม่`, `+ เพิ่มผู้รับเหมาช่วง` → door to `/contacts`, `เพิ่มสมาชิก`) at their new homes. No behavior change to any existing sheet/action — purely where they render.
- **U2 — fix-list.** The three derivable conditions as one pure query/shape function (unit-tested against fixtures for each condition, including the "all clear → empty" case) + the card component + its tap-throughs into existing sheets/prompts.
- **U3 — plan tab split.** Existing day-plan layer moves behind its own tab; tab label carries the unassigned-team-count for the day; no change to the plan RPCs or their gates.

Each unit shippable alone; U2 depends on nothing from U1 render-wise but reads more naturally after U1's bands exist.

## Testing

- RED-first per unit. U2's condition function gets fixture cases for each of the three triggers plus the "nothing wrong" empty case, mutation-checked (invert each condition, confirm it reds).
- RTL: band headers render the new labels/counts against real-shaped fixtures (sizes 7/6/6/2 style, a zero-worker firm, an unassigned worker) — assert absence of the old tier labels (ผู้บริหารโครงการ/หน้างาน as separate headers), not just presence of the new ones.
- Real-flow: dev-preview login → `/projects/<pilot>/team` — confirm the fix-list shows the real 8-unassigned line (the only condition true today; leadless-crew and zero-worker-firm are both correctly SILENT on live data), the ทีมภายนอก band shows exactly ช่างอวย with 3 named members (not the other 9 company contractors), the plan tab carries its count, `+ เพิ่มผู้รับเหมาช่วง` reaches `/contacts`. Zero console errors.
- Guard suites: design-doctrine (token classes only), feature-components-structure, ui-class-contracts (spec 359's colour-override class — verify no bare `bg-card`/`border-edge` collisions on the new fix-list card).

## Verification checklist

- `pnpm lint && pnpm typecheck && pnpm test` green per unit.
- Live query re-run at ship time for U2 (counts drift daily — re-verify unassigned/leadless/zero-worker-firm numbers are still what the tests assume as "today's real state," not stale from 2026-07-27).
- Fresh-eyes review before each unit ships (per doctrine §4).
