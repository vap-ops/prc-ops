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
  mapped, and not superseded.** `during` and `before` are excluded — they answer
  "what happened", not "what does done look like".
  ⚠️ **The `non-group` clause this decision asked for was NOT built.** The reason
  it was wanted is sound (a group rolls up to `complete` mechanically, so its
  completion is arithmetic rather than a judgement), but
  `wp_reject_group_binding()` already raises `23514` on any photo bound to a
  group, so no group WP can own a photo at all. The predicate would have been
  UNREACHABLE, and an unreachable clause asserts a hazard that is not there —
  spec 340's lesson, which cost three migrations. The trigger is pinned in 391's
  pgTAP instead, so relaxing it reds this unit and whoever relaxes it learns the
  filter is now needed.

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

⚠️ **As BUILT (this section originally specified a single argument — see §7.6/7.9):**

`get_wp_reference_photos(p_wp_catalog_item_id uuid, p_exclude_work_package_id uuid)`
— the second argument is **required**, and it is what makes the section
cross-project. Without it a completed WP is its own newest candidate and fills
every slot with its own photos. It has no default on purpose: with one, omitting
it was silent, and a future caller would reintroduce that bug with a green suite.

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
2. ~~**`wp_catalog_hidden_reference_photos` should stay near zero.**~~
   ⚠️ **RETRACTED — unmeasurable, for the same reason §7.1 gives about the star
   table.** `unhide_reference_photo` HARD-DELETES and neither writer touches
   `audit_log`, so a PD who hides thirty bad picks and later tidies up leaves a
   count of zero — indistinguishable from "D2 is selecting perfectly". This spec
   created the table _to be_ the feedback channel and then shipped the erasing
   half of it, which is §7.1's own finding re-committed one unit later. Either
   audit the hide/unhide pair or find the signal elsewhere; until then the row
   count is not evidence of anything.
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

6. ⭐ **U1's fix carried the same bug in the other arm, and the shipped UI could
   only ever create the case that triggers it.** U1b excluded the viewing WP from
   the DERIVED arm and exempted the STARRED one, reasoning that a PD's deliberate
   choice should be honoured. The call graph refutes that: the ⭐ renders only on
   `/review/work-packages/[id]`, and `star_reference_photo` derives the item from
   the photo's OWN work package — so **every star the application can create is a
   self-reference**. Four stars would fill the cap, the derived arm would return
   nothing, and a curated WP would show its own photos above its own gallery with
   the subtitle crediting the PD for it. **Rule: when you exempt something from a
   fix, ask which cases the UI can actually produce — not which cases are
   conceivable.** Fixed in 075902; the exclusion is symmetric.
7. ⚠️ **A hardening that changes another spec's contract is not a hardening.**
   075901 also added `w.status = 'complete'` to the starred arm, to make the
   subtitle's ทำเสร็จแล้ว claim true. It red FIVE assertions in
   `389-wp-catalog.test.sql`, which deliberately pin "a star surfaces
   cross-project" with no status condition — and it would have meant a PD stars a
   photo and sees nothing until approval lands. Reverted in 075902; the false
   claim was removed from the COPY instead, which is the end that was actually
   wrong. The underlying question ("should a star only count once approved?") is
   real and belongs to 389's owner, with its five assertions updated in the same
   breath.
8. ⚠️ **`has_table_privilege` answers a question about GRANT and says nothing
   about RLS.** The posture test for the hidden table passed while the migration's
   `create policy` could be deleted wholesale — the exact regression 075900 exists
   to prevent (a zero-grant table returns ZERO ROWS to the RLS client rather than
   erroring, so the toggle reads "not hidden" for every photo and a hide looks
   like a failed write). A posture assertion must READ AS THE ROLE. And once the
   grant was narrowed to one column, `has_table_privilege` went false — so the
   column-level pin is `has_column_privilege`, and the row-count probe must name
   the granted column, since `count(*)` needs no column and passes under a grant
   that exposes nothing.
9. ⚠️ **The argument that makes the whole feature work had no application-side
   guard.** Nothing pinned `workPackageId={wp.id}` at the call sites or
   `p_exclude_work_package_id` in the reader — TypeScript only knows it is a
   string, so `{wp.parent_id}` or `{params.projectId}` would compile, pass every
   pgTAP, and silently restore the 403-of-403 self-reference. Two source pins
   added; the DB half is closed by making the parameter REQUIRED (075901), so
   omitting it is a hard 42883 instead of a silent full set. ⭐ **And the first
   version of that pin counted the bare prop, which appears 17 times on the page
   for other components — it expected 2 and found 17. Pin the whole call site.**
