# 391 — ตัวอย่างงาน fills itself (automatic reference photos)

Operator, 2026-08-04: _"for the confirmed WP, can you default star to them? we
don't want to add unnecessary workload to pd"_.

Spec 389 U5 shipped the ⭐ affordance and the ตัวอย่างงาน section. Both work. The
section is empty anyway, because filling it is a manual act nobody has performed:
`wp_catalog_reference_photos` holds **0 rows**, against 1,904 photos across 201
mapped WPs. This spec removes the manual act from the common path.

> **This spec was rewritten after a refute-first fact-check.** Its first draft
> carried two "correctness" decisions that did nothing, a pool number that
> contradicted its own candidate rule, and a hide mechanism the schema refuses.
> §7 records what was wrong, because the reasoning that produced it will recur.

---

## 1. What is actually true today (measured live 2026-08-04)

|                                                             |                                                  |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `wp_catalog_reference_photos`                               | **0 rows** (see §7.1 — "all-time" is unprovable) |
| Leaf WPs at `complete`                                      | **185**                                          |
| Catalog items reachable from a complete, mapped **leaf** WP | **144** of **455**                               |
| Their `after` + `after_fix` photos                          | **623**                                          |
| Per catalog item                                            | min 1 · **median 3** · p90 7 · **max 61**        |
| Items reachable but with no candidate                       | **0**                                            |
| Mapped leaf WPs whose page would gain examples              | **432 of 1,075 (40%)**                           |

**The pool is the right shape where it exists.** Every one of the 144 reachable
items has at least one candidate and the median is 3 — this is not a feature
waiting on more data.

**But it is not a whole-surface fix.** 311 of 455 catalog items have no complete
WP yet, so ~60% of mapped WP pages still render nothing after U1. That is
correct behaviour, not a gap: an item nobody has finished has no example to show.
Stated here so the acceptance number in §5 is not mistaken for "the section is
solved".

**The tail is real.** One item carries 61 candidates and 37 items (26%) exceed
the cap. A section titled ตัวอย่างงาน that renders 61 photos is a gallery, and a
gallery answers a different question than an example does.

---

## 2. Decisions

- **D1 — the default is DERIVED, not backfilled.** `get_wp_reference_photos`
  gains a fallback; no rows are written for it. A backfill is a point-in-time
  snapshot: WPs completed next month would need another one, and the
  empty-section problem returns the moment someone stops running it.
  _Rejected, recorded:_ writing ~623 star rows now. It reads as "the PD curated
  this" when nobody did, and it makes `starred_by` a lie.

- **D2 — candidates are `after` + `after_fix` photos of WPs that are `complete`,
  mapped, non-group, and not superseded.** Group WPs are excluded explicitly:
  they roll up to `complete` mechanically when their children do (9 of the 194
  complete WPs), so a group's completion is an arithmetic fact, not a judgement
  about work. `during` and `before` are excluded — they answer "what happened",
  not "what does done look like".

- **D2a — the rework-round filter is kept, and it is INERT TODAY. Say so.**
  Candidates are taken at the WP's highest `rework_round`. ⚠️ **Every one of the
  2,873 rows in `photo_logs` is at round 0**, so this filter currently excludes
  nothing. It is kept because `photoReworkRoundFor`
  (`src/lib/photos/rework-round.ts:16`) stamps `after_fix`/`defect` with the WP's
  round while pinning `before`/`during`/`after` to 0 — so the day a real
  send-back happens, this filter is what stops the rejected `after` photo
  standing as the example for its work type. It costs one predicate.
  ⚠️ **It must NOT be justified by the 10 complete WPs that carry `after_fix`
  photos.** Those had **zero rejections**; the repo already classifies them
  (`rework-round.ts:41-48`) as pre-spec-353 legacy free-capture. The first draft
  of this spec cited them as proof and was wrong — see §7.2.

- **D3 — cap 4, newest first.** **Unit: photos per catalog item after the D2
  filter**, not per WP (several WPs across projects map to one item). Median is
  3, so 107 of 144 items (74%) are unaffected; **37 items are truncated and 220
  of 623 candidates never render**. That is the price of the section staying an
  example rather than an archive, and it is a real quarter of the catalogue, not
  just the 61-photo outlier.

- **D4 — explicit stars are ADDITIVE.** Starred photos pin to the front, then
  derived picks fill the remainder up to 4. A PD who stars one good photo should
  not silently delete the other three; curation here is promotion, never erasure.

- **D5 — a PD can HIDE a photo, and hiding gets its OWN table.** Un-star removes
  a choice someone made; hide suppresses a photo nobody chose. They cannot share
  `wp_catalog_reference_photos`: `starred_by` is **NOT NULL**, so a hide-only row
  has no value to put there, and the shipped `unstar_reference_photo` deletes by
  `photo_log_id` with no guard — un-starring would silently delete a hide.
  So: **`wp_catalog_hidden_reference_photos` (`photo_log_id`, `hidden_by`,
  `created_at`)**. Additive, no destructive ALTER, no interaction with the
  existing writer, and it makes D5's "these are different acts" structural rather
  than a comment. A hidden photo is excluded from the derived set **and** the
  starred set — hiding always wins.

- **D6 — NO visibility gate. The reader keeps ONE argument.**
  ⚠️ **The first draft's premise was false and the operator decided on it.**
  `get_wp_reference_photos` is **not** world-readable: `anon` cannot execute it
  (revoked in `20260813075893`, and `389-wp-catalog.test.sql:96` already asserts
  it), only `authenticated` can. There is no signed-out reader to split from, so
  a `p_include_derived` argument would have been a gate that is always true — and
  adding a second argument would have created an _overload_, leaving the shipped
  1-arg caller bound to the old body forever.
  The real axis is which signed-in ROLES see cross-project photos. Spec 389 U5
  chose deliberately wide ("any authenticated caller — including `visitor`").
  Operator, re-asked on the corrected facts 2026-08-04: **that choice stands.**
  A ช่าง seeing what good work looks like is the point of the catalogue.

- **D7 — starred photos stay visibly starred**, so a PD can see what their
  curation did. Without it, starring a photo that was already showing is an
  action with no visible result.

- **D8 — the section's subtitle must stop claiming a human chose these.** It
  currently reads _"รูปที่ผู้อำนวยการโครงการปักดาวไว้"_ — "photos the project
  director starred" (`reference-examples.tsx:38`). Rendering derived photos under
  that heading is exactly the lie D1 refuses to write into the table. The copy
  becomes truthful for a mixed set.

---

## 3. The reader, stated precisely

`get_wp_reference_photos(p_wp_catalog_item_id uuid)` — **same signature**, body
replaced:

1. **Starred** — rows in `wp_catalog_reference_photos` for this item whose photo
   is not hidden, newest first.
2. **Derived** — photos matching D2 + D2a, excluding hidden ones and any already
   returned as starred, newest first.
3. Concatenate, truncate to **4** (D3).

Because the signature is unchanged, `CREATE OR REPLACE` genuinely replaces it,
the existing caller keeps working, and the three 389 pgTAP assertions about its
grants stay green and meaningful.

---

## 4. Units

**U1 — schema + reader (schema lane).** `wp_catalog_hidden_reference_photos`
(+RLS, no direct write grant); `hide_reference_photo` / `unhide_reference_photo`
(PD tier, mirroring the live star pair's null-safe `42501` gate); the
`get_wp_reference_photos` body replacement. pgTAP:

- **a positive control** — the derived arm returns a real photo, so an empty
  result cannot be mistaken for a working filter;
- a photo from a WP at `pending_approval` is NOT derived;
- a photo from a **group** WP is NOT derived (D2);
- a `during` photo is NOT derived, an `after_fix` photo IS;
- **the rework-round filter, on a synthetic fixture** — with an explicit comment
  that no production row exercises it (D2a), so the next reader is not misled
  into thinking it is covering live behaviour;
- a hidden photo is absent from BOTH arms;
- **un-starring a hidden photo leaves it hidden** — the defect the separate table
  exists to prevent;
- the cap holds at 4 with 5 candidates;
- starred pins ahead of derived (D4);
- `anon` cannot execute either writer (`has_function_privilege`, the house
  pattern), and the reader's existing grants are unchanged.

**U2 — the surfaces.** The ⭐ toggle on `/review` gains ไม่ใช้เป็นตัวอย่าง;
starred photos carry the marker (D7); the subtitle copy becomes truthful (D8).
⚠️ The section currently returns `null` when empty by deliberate design
(`reference-photo-section.tsx:39`) — that stays; U2 authors no empty state.

Sequential: U1 → U2.

---

## 5. Acceptance — a fill rate, not a green suite

1. **ตัวอย่างงาน stops being empty where an example exists**: 0 → **144 of 455**
   catalog items, i.e. **432 of 1,075** mapped leaf WP pages. Not "the section is
   solved" — 311 items have no complete WP yet.
2. **`wp_catalog_hidden_reference_photos` should stay near zero.** A burst of
   hides means D2 is selecting badly and the _filter_, not the affordance, needs
   work. That table is the feedback channel this design has.
3. **Re-read the per-item distribution before trusting the cap.** Median 3 is
   today's number and it moves as WPs complete. If it passes 4, the cap is
   hiding the common case rather than the tail.

---

## 6. Out of scope, recorded

- **Ranking the 4.** Newest-first is a placeholder for quality, which nothing in
  the schema models. If "best" is wanted rather than "latest", that is a human
  judgement and D4's star is the intended answer.
- **Back-filling the 0 rows** — rejected in D1.
- **`unstar_reference_photo`'s over-broad delete** (it deletes across all catalog
  items for a `photo_log_id` while the unique key is `(item, photo)`). Harmless
  today — one photo has one WP, so one item — but wrong if a photo ever maps to
  several items. Left alone; noted so it is not mistaken for correct.
- **The 61-photo item.** The cap makes it harmless; consolidating it is
  catalogue hygiene.

---

## 7. What the fact-check killed, and why it matters

1. **"0 rows all-time" is unprovable.** `unstar_reference_photo` hard-deletes and
   neither writer audits, so the table cannot distinguish "never used" from "used
   and undone". The claim is now "0 rows".
2. **The rework-round filter was justified with the wrong evidence.** Draft 1
   claimed 10 live WPs proved defective work would be shown. Those WPs had zero
   rejections and their `after_fix` photos are documented legacy free-capture.
   ⭐ **The lesson: a column's NAME is not evidence of its CONTENT.** One
   `select min(rework_round), max(rework_round)` — which returns 0, 0 over all
   2,873 rows — would have caught it before it reached a spec.
3. **The pool number contradicted the candidate rule.** §1 said 564 while D2
   included `after_fix`; the real figure for D2's own set is 623. A spec that
   argues for a set and then reports a different one has not been read end to end.
4. **`starred_by` NOT NULL made D5 unbuildable** as drafted, and the fix would
   have been a destructive ALTER. The separate table is better on the merits.
5. **The world-readable premise was inverted**, and it had already been pinned by
   a green test I did not read. ⭐ **Before designing a change to a permission
   posture, run `has_function_privilege` and grep the pgTAP for an existing
   assertion about it** — the answer was one query and one grep away, and the
   wrong version reached the operator as a decision to make.
