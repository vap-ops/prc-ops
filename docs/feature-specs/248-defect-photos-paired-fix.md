# Spec 248 — Defect photos on รายงานข้อบกพร่อง + paired after-fix evidence

**Status:** DRAFT v2 (design direction approved by operator 2026-07-03; v2 folds a 4-lens adversarial design review — 28 findings, 3 blockers, all addressed below)
**Origin:** operator — "รายงานข้อบกพร่อง most of the times have attachments" + "each image requires after-fix image from the same angle (we will need them to make report)". Today `ReportDefectControl` takes a source toggle + text reason only; the reason lands in `audit_log.payload`, the WP flips to `rework` (round++). No photos.

## Goals

1. The PM/PD filing a defect attaches photos of the defect.
2. The SA fixing the rework sees those photos where they work: the rework banner and the per-round หลังแก้ไข gallery section — and the PM sees the pairs on the review page when deciding.
3. **Pairing:** each defect photo must be answered by ≥1 after-fix photo taken from the same angle; the pair is recorded (`answers_photo_id`) for a future defect→fix report.
4. The spec-247 submit gate tightens for rework (floor AND pairing — see Gate).

## Data model (schema lane, 2 migrations, next timestamps `059000+`)

- **M1 (enum, own migration per db lessons):** `alter type photo_phase add value 'defect'`.
- **M2:** on `photo_logs`:
  - `answers_photo_id uuid NULL references photo_logs(id)` + partial index (`where answers_photo_id is not null`).
  - Same-row CHECK `photo_logs_answer_only_on_real_photo`: `answers_photo_id is null or storage_path is not null` — a tombstone can never carry an answer (ADR 0015 all-payload-NULL doctrine).
  - BEFORE INSERT trigger, **null-permissive** (`if NEW.answers_photo_id is not null then …`), validating the target row is: same `work_package_id` · `phase = 'defect'` · **a real photo, not a tombstone** (`storage_path is not null`) · **same round** (`target.rework_round = NEW.rework_round`). NEW row itself must be `phase = 'after_fix'`. Error messages generic (no existence oracle beyond what `can_see_wp` already reveals).
  - Trigger validation is insert-time-only; a concurrent tombstone of the target between check and commit is **accepted** (the gate re-reads current state at submit, so a dangling answer only under-counts, never over-counts).
- Defect photos are ordinary `photo_logs` rows: `phase='defect'`, `rework_round` = the round they open (post-RPC value), **tombstone-removable only** — like every photo_logs row there is NO content-bearing supersede (the well-formedness CHECK forecloses it; ADR 0015). "Editing" a photo = tombstone + fresh capture.
- `photoReworkRoundFor` gains a `defect` arm (defect + after_fix stamp the WP's current round; others 0).
- **Attribution hardening (side-fix, same M2):** the photo_logs INSERT policy does not pin `uploaded_by = auth.uid()` — evidence attribution is forgeable by any allowed role. Add the pin (`with check (… and uploaded_by = auth.uid())`); `addPhoto` already sets it correctly, so no app change.
- **Client portal:** the portal's photo SELECT is phase-blind; once a reworked WP returns to `complete`, defect photos (possibly `internal`-source) would leak to the client. Exclude `phase = 'defect'` from the client-portal read arm (safe default; operator can widen later).

## Removal rule (closes the gate-bypass blocker)

`phase='defect'` photos are removable **only by the roles that can file a defect** (PM/PD/super_admin):

- App layer: `removePhoto` refuses a defect-phase target for other roles.
- DB layer: the M2 trigger also fires for tombstone inserts; when the TARGET row (`superseded_by` chain) is `phase='defect'`, require `current_user_role()` ∈ {project_manager, project_director, super_admin} (null-safe, fail-closed).

Without this, the gated SA could tombstone the PM's defect photos and collapse the pairing requirement — the review's top blocker, found by two independent lenses.

## Behaviour

### Filing (PM/PD — U2)

`ReportDefectControl` gains photo capture (reuse the `usePhaseCapture` engine's downscale/upload parts). Sequencing (photos must carry the NEW round, which exists only after the RPC):

1. Upload bytes to Storage (browser-direct).
2. Call `reopen_work_package_for_defect` (unchanged RPC).
3. Insert metadata rows (phase `defect`) — stamped with the bumped round.

**Online-only, explicitly:** defect filing does NOT enter the offline IDB queue. The queue's replay would race the round bump and could stamp a closed round's evidence (review blocker #3). The form disables submit while offline (`navigator.onLine` + in-flight state) and while photo bytes are in flight. Failure between 2 and 3: retry the metadata insert client-side (bytes already up, insert is idempotent by photo id); if it still fails, surface "แนบรูปไม่สำเร็จ — แตะเพื่อลองใหม่" with the defect already filed. Orphaned Storage objects accepted (ADR 0015 stance).

`addPhoto` changes: the `PHOTO_PHASES` runtime allowlist (actions.ts) must include `defect` — **typecheck will NOT surface this; it is a runtime string list** (review major). Defect-phase inserts are additionally scoped: role ∈ PM/PD/super AND the WP is currently in `rework` with `rework_round` = the stamped round (no closed-round pollution, no SA-side defect inserts).

### Display (SA — U3)

- Rework banner: current round's defect photos as a strip under the reason, lightbox-viewable.
- Per-round หลังแก้ไข gallery section: that round's defect photos render beside the round's reason note (past rounds keep evidence context, read-only — no capture slots on closed rounds).
- **Review page** (PM approve/reject surface): the current round's pairs render defect→fix side by side, so the PM verifies "same angle" where they decide.

### Paired capture (SA — U3)

In `rework`, each current-round current defect photo shows its answer state:

- Unanswered → a "ถ่ายรูปแก้ไข (มุมเดิม)" slot. Tapping opens the shutter **with the defect photo shown as a reference overlay/thumbnail at framing time** (the "same angle" instruction is only actionable if the SA sees the original while framing — review UX major). The captured after_fix row carries `answers_photo_id`.
- Answered → the paired after-fix thumbnail (tappable to lightbox both).
- Slot targets ≥44px, one-hand reachable (Field-First).

**The generic after_fix capture path (banner CTA → CaptureSheet) is redirected during pairing-pending state:** while any current-round defect photo is unanswered, the banner CTA scrolls to the paired slots instead of opening a free shutter — otherwise muscle-memory produces unpaired photos that can never satisfy the gate (review major). Free (unpaired) after_fix capture stays available once all pairs are answered, and on rounds with no defect photos.

After an answer is tombstoned, re-pairing happens ONLY through the capture slot (fresh insert with `answers_photo_id`); there is no pairing inheritance — an unpaired retake does not satisfy the gate.

Offline: the paired capture uses the existing offline queue, so `answers_photo_id` must travel with the queued item — extend `QueuedUpload`/`AddPhotoInput`/runner types (review major: today they carry no such field; without this, replay silently drops pairing). `addPhoto`'s idempotent-replay identity check extends to `answers_photo_id`.

### Submit gate (U4 — amends spec 247's rework rule)

A `rework` WP is submittable when BOTH hold for the CURRENT round (floor AND pairing — never a fallback that a removal can reach):

1. **Floor:** ≥1 current after_fix photo of the round (spec 247's rule, unchanged).
2. **Pairing:** every current defect photo of the round has ≥1 current after_fix answer (`answers_photo_id`, both sides current-state: anti-join + tombstone).

A text-only round (zero current defect photos) satisfies (2) vacuously and is governed by the floor — same effective behaviour as spec 247. A round with defect photos can never weaken back to floor-only, because defect-photo removal is PM/PD/super-gated (see Removal rule).

Hints: `submitEvidenceHint` gains a pairing-aware variant — the signature extends beyond status (e.g. unanswered count) to render "ถ่ายรูปแก้ไขให้ครบทุกจุดที่แจ้ง (เหลือ N จุด)". Enforced in both layers (disabled button + server action), same shape as spec 247.

### Deploy-window tolerance (ships in U1, before/with M1)

`selectCurrentPhotosByPhase` throws on an unknown phase key (`result[r.phase].push` → TypeError). During the deploy window (migration applied, an older build still serving) a `defect` row would crash every photo read for that WP. U1 makes the reader tolerant FIRST: unknown phases are skipped (or bucketed) instead of thrown, deployed before or with M1.

## Sequential rounds (verified, pinned)

Rounds are strictly sequential: `reopen_work_package_for_defect` requires `complete`, so a new round cannot open mid-rework. Corollary (accepted): the PM cannot append defect photos to the current round after filing — the defect form is the only entry point and it always opens a NEW round. If the field demands mid-round additions, that is a future amendment.

## Progress derivation — untouched

`PHASE_ORDER` stays before/during/after; `defect` (like `after_fix`) is outside the progress bar. Spec-247 first-pass rule unchanged. `Record<PhotoPhase, …>` shapes gain the `defect` key after `db:types` regen (typecheck surfaces those; the runtime `PHOTO_PHASES` list and the SA capture strip's phase offering are the two NON-typechecked sites — the capture strip must not offer `defect`).

## Units

| Unit | Lane   | Content                                                                                                                                                                                                                                                        |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1   | SCHEMA | Tolerant reader FIRST, then M1 enum + M2 (column, CHECK, index, trigger incl. removal-role + same-round arms, uploaded_by pin, client-portal defect exclusion) + db:types regen + `photoReworkRoundFor` defect arm + Record-shape keys + pgTAP (see checklist) |
| U2   | code   | PM defect-photo capture on `ReportDefectControl` (online-only; upload → RPC → metadata retry; PHOTO_PHASES + defect-scope in addPhoto)                                                                                                                         |
| U3   | code   | Banner strip + per-round gallery + review-page pairs + SA paired capture slots (reference-at-framing, CTA redirect, offline queue carries answers_photo_id)                                                                                                    |
| U4   | code   | Submit-gate amendment (floor AND pairing; pairing-aware hints) — extends `canSubmitForApproval`                                                                                                                                                                |

Out of scope: the defect→fix report generator (future spec; consumes `answers_photo_id`); markups on defect photos; per-pair notifications; mid-round defect additions; the pre-existing direct-REST metadata-forgery class (documented: `storage_path` not pinned to the WP's prefix — chip separately).

## Verification checklist

- [ ] pgTAP: enum value present; CHECK rejects tombstone-with-answer; trigger rejects (a) answer from non-after_fix, (b) cross-WP target, (c) non-defect target, (d) tombstoned-defect target, (e) cross-ROUND target, (f) defect-tombstone by site_admin; accepts (g) after_fix tombstone with NULL answer, (h) defect tombstone by PM, (i) valid same-round pair; uploaded_by pin rejects a forged uploader; client-portal read excludes defect phase; append-only stack intact.
- [ ] Unit: `photoReworkRoundFor('defect', n) === n`; tolerant reader skips unknown phases; gate matrix — all-answered / one-unanswered / tombstoned-defect (still counted? no — not current) / tombstoned-answer + unpaired retake → still blocked / text-only round → floor governs / floor-unmet with all pairs answered → blocked; action refusal messages incl. "เหลือ N จุด".
- [ ] UI: capture on defect form (offline-disabled state); paired slot renders reference at framing; CTA redirect while pairs pending; review-page pairs.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + full `pnpm db:test` green; real-browser pass at 375px.
