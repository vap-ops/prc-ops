# Spec 370 — Scan equipment in/out (QR + NFC) with condition photos

**Status:** designed + operator-approved 2026-07-28 (mockups in chat). Not built.
**Origin:** operator, 2026-07-28, extending spec 368 U4's store view:

> Prepare for scanning items in/out (nfc/qr with backup method)
> Scanning opens up a camera to take pisture(s) of equipment condition

> search can be with names or s/n

**Depends on:** spec 368 U4 (the split view this flow feeds). Spec 363 U7
(WP-side browse ยืม) becomes the alternate door — same RPCs.

⚠️ **PREREQUISITE (fact-check blocker, 2026-07-28): no borrow can complete
today.** `check_out_equipment` hard-refuses an unpriced item (P0001 `item has
no daily rate (price it first)`; `daily_rate_snapshot` is NOT NULL) and
`daily_rate` is **0/64** — so the ยืม leg is dead for every item until one of:
(a) back-office prices the fleet (`set_equipment_daily_rate` per item — its
allowlist excludes site_admin, so the SA cannot self-serve; spec 367's
money-import RPC would bulk it), or (b) a schema unit makes the rate optional
for internal borrows (column nullable + RPC arm — money-adjacent, DROP+CREATE,
sig-pin ripple). 🔔 **Operator decision.** Compounding: `daily_rate` carries no
`authenticated` column grant, so the UI cannot read it to pre-empt the refusal
— whichever option wins, the scan flow must surface the P0001 message honestly
rather than swallow it.

## 1. Decisions (operator-locked in chat)

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **Scan is the primary door for BOTH directions, at the store.** Scanning an in-store item opens the ยืม sheet (pick WP → photos → out); scanning an out item opens the คืน sheet (photos → in). This deliberately revises the earlier "ยืม is WP-side only" lock — the physical handoff happens at the store. The WP `ของ` tab (363 U7) stays as the browse path.          |
| **D2** | **Identity = the item's uuid in a deep link**, `/equipment/scan?item=<uuid>`. A QR sticker encodes that URL; an NFC tag is an **NDEF URL sticker carrying the same link** — iPhone and Android both open URL tags natively, so there is **zero NFC code** in the app. No Web NFC API (Android-only, dead end for this iOS-heavy field crew).                               |
| **D3** | **Backup method = search on the same screen** — by name **or serial number** (operator: "search can be with names or s/n"); `asset_tag` matches too since it is what's physically written on older gear. Damaged sticker, missing sticker, dead camera — same flow, one extra tap.                                                                                         |
| **D4** | **Condition photos are REQUIRED, ≥1, in BOTH directions.** The camera opens as part of the flow; the submit button stays disabled until a photo exists. Evidence both ways is the feature's point (the self-purchase precedent: optional evidence = 0/4 ever). The คืน sheet shows the borrow-time photos beside the new ones for comparison.                              |
| **D5** | **Units only in v1.** The 9 bulk-tracked rows (scaffolding etc.) are not scan-borrowable; they render in the store view with qty and move only as site-level movements. Prove the habit on the 55 unit items first.                                                                                                                                                        |
| **D6** | **The SA does not edit registry `condition`.** Photos are the condition record; the enum stays back-office curated (`equipment_items` UPDATE policy is back-office by design). No condition picker in the scan flow.                                                                                                                                                       |
| **D7** | **Photos live in a new `equipment_usage_photos` table** pointing at the usage-log row, phase-tagged `out`/`in`, stored in the existing private `equipment-images` bucket under a `usage/` prefix. The TABLE carries the log link — the path only needs the prefix + uniqueness, because at ยืม time the log id does not yet exist (photos upload BEFORE the RPC mints it). |

## 2. Live grounding (2026-07-28)

- `equipment_usage_logs` = **0 rows ever** — spec 202 U2 was specced 2026-06-25
  and never built. The RPCs are live and verified from the catalogue:
  `check_out_equipment(p_item uuid, p_wp uuid, p_date date)` ·
  `check_in_equipment(p_log uuid, p_date date)`. Both gate on the
  EQUIPMENT_MOVE_ROLES set (read from the live definitions, incl. the
  `can_see_wp` membership arm for site_admin/project_manager) and close via
  append-only supersede. **Re-verify signatures at build time — a signature is
  a contract, not a memory.**
- **The `equipment-images` bucket INSERT policy admits only the back-office
  set** (spec 367 U1 took the `equipment_items` INSERT audience). A site_admin
  upload today would 42501. **U1 must widen the storage policy** to the scan
  audience — this is the schema-lane blocker, found by gate-check before build.
- Identity fill rates: `asset_tag` 5/64 · `serial_no` 0/64 (column landed in
  367 U1; the 367 U3 importer is how it fills). Search degrades gracefully —
  name always exists.
- Scanner precedent: the muster QR scanner (spec 306/359) is field-proven —
  **17 of 18 check-ins by QR** on 2026-07-27 — and its camera/decode component
  (native BarcodeDetector + jsQR iOS fallback, ≤480px downscale, ≥180ms
  throttle) is the piece U2 reuses. Same-tick decode hazards are documented
  there (cooldown state must live in refs, `fireEvent` twice in one `act()`).
- Camera capture + compression: the house photo uploader already does
  direct-camera capture; reuse, do not re-roll.

## 3. Units

### U1 — schema (single schema-lane claim)

- `equipment_usage_photos`: `id` · `log_id` FK → `equipment_usage_logs` ·
  `phase` enum `out`/`in` · `storage_path` · `taken_by` · `created_at`.
  Append-only in spirit; no UPDATE policy. SELECT for the staff read set
  (mirror `equipment_movements readable by staff`); INSERT for
  EQUIPMENT_MOVE_ROLES with `taken_by = auth.uid()`.
- ⚠️ The bucket policy fix is a REWRITE, not an audience widen: the live
  `equipment-images uploads by back office` WITH CHECK ends
  `array_length(storage.foldername(name), 1) = 1`, which refuses any
  `usage/<x>/…` depth-2 path for EVERYONE, super_admin included (fact-check
  2026-07-28). New predicate: back-office keeps the root for registry images;
  EQUIPMENT_MOVE_ROLES may write under `usage/` only.
- **Extend both RPCs once, in this unit** (DROP+CREATE, and bump
  `36-rpc-execute-lockdown`'s signature pins in the SAME PR — the spec-357
  queue-ejector): `p_via text default null` (scan/search/wp-tab — without it
  §5's door-share metric is uncomputable; the `answers_photo_id` 0-of-2,672
  failure mode; shipped as enum `equipment_usage_via` = scan/search/wp_tab/
  **store** — the 4th value is 368 U4's คืน-at-store door) and
  `p_borrower_worker_id uuid default null` on check-out —
  `entered_by` is ALWAYS the SA under D1, so "who took it" is otherwise
  underivable (fact-check F5). ยืม sheet gains an optional ผู้รับ picker
  (PersonPicker idiom, the เบิก precedent).
- pgTAP: policy pins both directions (SA can insert a usage photo under
  `usage/`, cannot write the root; back-office keeps the root; positive
  control per the absence-assert rule).
- ⚠️ The supersede trap, full shape: check-in INSERTS a superseding row, and
  BOTH phases' photos key on the ORIGINAL log id — so after คืน, the current
  (non-superseded) row carries ZERO photos and every photo hangs off a
  superseded one. Any reader keyed on current rows shows photo-less completed
  loans. Follow the chain from the original id; pin this in a test — it is
  the trap of the unit.

### U2 — the scan flow

- Route `/equipment/scan` (+ `?item=<uuid>` deep-link entry). Gate:
  EQUIPMENT_MOVE_ROLES (same as `/equipment`).
- No param → camera QR scanner (reuse the muster component) + a search field
  (name / serial_no / asset_tag) — D3's backup, always visible, no second
  screen. Search runs over ALL items the viewer's RLS can read (`equipment_items`
  read is role-scoped, not project-scoped); each result names its current
  project, so a mis-shelved tool is findable. Authority is enforced by the
  RPCs, not the search.
- Resolved item → state decides the sheet (open-log anti-join, spec 368 §6.1):
  - **In store → ยืม sheet:** WP picker (the PersonPicker-style search sheet
    over the leaf WPs of the item's CURRENT project — from its latest
    `deployed` movement) · camera capture strip (≥1 required) → upload →
    `check_out_equipment` → insert `out` photo rows.
  - **Out → คืน sheet:** borrow context (WP · days · who) · the `out` photos
    rendered for comparison · camera strip (≥1 required) · date (default
    today) → upload → `check_in_equipment` → insert `in` photo rows against
    the ORIGINAL log id.
- Bulk item scanned/picked → explanatory refusal (D5), not a silent nothing —
  enforced in the SERVER ACTION, not just the sheet: `check_out_equipment` has
  no `tracking` guard (fact-check F7), so a raw deep link to a bulk uuid must
  hit the action's refusal, not sail into the RPC. (Middle-layer-refuses-what-
  the-RPC-allows is the deliberate v1 scope-hold; the inverse of the spec-187
  parity bug, documented here so the next audit reads it as a decision.)
- Failure order: upload photos to storage FIRST, then RPC, then photo rows —
  a failed RPC must not leave the flow claiming success (silent-success rule);
  orphaned storage objects are acceptable, a photo-less completed log is not.
- Outcome states its result in place (the ⭐ silent-success lesson: dismissing
  a full-screen surface is indistinguishable from a crash) — "ยืมแล้ว →
  W05-03 · รูป 2" with the item named by id, not just name.

### U3 — stickers + tags

- Print page for QR labels (all items, or filtered), print-CSS grid, each
  label = QR of the deep link + name + asset_tag. Back-office surface on
  `/equipment`.
- NFC: document the procedure in `docs/automations.md` (automation-doc
  doctrine): buy NDEF stickers, write the same URL with any writer app,
  stick beside the QR. No app code.

### U4 — entry points

- `สแกน` button on the store section header (spec 368 U4 surface) and on
  `/equipment`. Both just link the route — the deep link itself is the NFC/QR
  entry and works from anywhere.

**U4b — prominence redesign (2026-07-28, after two field reports).** U4 as
written put every door on a surface the SA has to navigate to. #821 then hoisted
a text link to the top of the store page; the operator judged it "not prominent
enough". Telemetry settled where the door belongs: over 7 days a `site_admin`
generated **1,367** route events on `/sa`, **20** on the project store and **2**
on `/equipment*`. #821 fixed the position on a page the SA does not open — so
the door becomes a shared `EquipmentScanDoor` hero (accent ground, QR mark, a
subtitle naming the physical act) with two homes: the **SA home**, between
แผนวันนี้ and the เครื่องมือ tiles, and the **top of the store page**, replacing
#821's link. The store section keeps its own contextual link — removing it would
delete an affordance from the one place the tools are listed.

- **No count line.** With `equipment_usage_logs` at 0 the door would read
  "0 ยืมออก", and deriving it on `/sa` means an items + movements + open-log read
  on the app's heaviest page. Counts stay on the store section, where §6.1 of
  spec 368 already loads that data.
- **The `/sa` copy is ungated.** `SA_SURFACE_ROLES` ⊆ `EQUIPMENT_MOVE_ROLES`, so
  a role gate would be an arm that can never fail (the spec-340 unreachable-clause
  defect). The subset invariant is pinned in `role-sets.test.ts` instead, so
  adding a non-mover to the SA home reds and asks for the gate. The store page
  keeps its `canReturnEquipment` gate — that page admits non-movers.
- ⚑ **Logged, not built (fresh-eyes):** `src/lib/sa/help-content.ts` — the SA's
  in-app คู่มือ has topics for photos, muster, crew and the cold restart, and
  none for equipment scan. The unit's own diagnosis is "the SA cannot find it",
  so the help SSOT never naming the door is a real gap; it is a content unit,
  not this one. Also unpinned by any test: the `/equipment` page's own door.
- ⭐ **The lesson #821 half-learned:** a door's EXISTENCE is not its
  DISCOVERABILITY, and neither is its POSITION — position only counts on a page
  the user already opens. Rank candidate hosts by that user's real route
  telemetry before choosing where to put a primary action.

## 4. Non-goals

- Web NFC API / in-app tag reading or writing.
- Offline scan queueing (app is online-first).
- Bulk-qty borrows (D5) — revisit when unit adoption is proven.
- Editing `equipment_items.condition` from the field (D6).
- Movement kinds (received/returned/maintenance/lost) — `/equipment` owns them.
- Charging rental cost per borrowed day. (`daily_rate_snapshot` is written by
  the RPC — as a hard PRECONDITION, see the header blocker — but no money
  renders in this flow; money surfaces stay where ADR 0055 put them.)

## 5. Acceptance (fill-rate, not green suite)

- Share of `equipment_usage_logs` by `via` (scan vs search vs wp-tab — the
  muster QR-share query shape; computable because U1 adds the column).
  ⚠️ Query note: the BORROW door lives on rows `where superseded_by is null`
  (originals); a closing row's `via` is the RETURN door — the INVERSE of the
  house current-state anti-join. Both directions are pinned in the pgTAP.
- % of logs carrying ≥1 photo per phase — must be 100% by construction; a
  lower number means the requirement leaked.
- Median days-out per item once real loans exist.

## 6. Open questions

- **What D4's existence check does and does not stop** (decided at 363 U7
  build): the actions verify every submitted path has a REAL object behind it
  (a well-shaped string with no upload would otherwise satisfy the gate), but
  do not attempt to stop a caller re-submitting a genuinely-uploaded file as
  different-phase evidence — D4 protects against omission, not an SA actively
  forging their own condition record.
- **No add-photo-later affordance exists.** A partial failure (span recorded,
  photo rows didn't land) is reported honestly and leaves a photo-less loan;
  attaching photos to an existing loan is a candidate U2+ addition.

- **Unpriced spans are permanently free** (fresh-eyes F11): `daily_rate_snapshot`
  is written only at check-out, the logs are append-only, and no correction RPC
  exists — so borrows taken before the fleet is priced charge 0 forever, and
  nothing surfaces "this WP has N unpriced equipment-days". Acceptable while the
  seeding data-op lands the same day; a snapshot-backfill RPC becomes its own
  unit if pricing ever lags borrowing again.

- Photo count cap per phase (default: the house uploader's existing limit).
- NFC tag hardware: operator buys; which sticker size survives site tools.
- Whether the scan route should also resolve WORKER badges later (one scanner
  to rule muster + tools) — out of scope, noted for the AI-first direction.
