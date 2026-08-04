# 391 — ตัวอย่างงาน fills itself (automatic reference photos)

Operator, 2026-08-04: _"for the confirmed WP, can you default star to them? we
don't want to add unnecessary workload to pd"_.

Spec 389 U5 shipped the ⭐ affordance and the ตัวอย่างงาน section. Both work. The
section is empty anyway, because filling it is a manual act nobody has performed:
`wp_catalog_reference_photos` holds **0 rows**, against a pool of 1,904 photos
across 201 mapped WPs. This spec removes the manual act from the common path.

---

## 1. What is actually true today (measured live 2026-08-04)

|                                                         |                                           |
| ------------------------------------------------------- | ----------------------------------------- |
| `wp_catalog_reference_photos`                           | **0 rows all-time**                       |
| Leaf WPs at `complete`                                  | **185**                                   |
| Catalog items reachable from a complete, mapped WP      | **144**                                   |
| Their `after` / `after_fix` photos, latest rework round | **564**                                   |
| Per catalog item                                        | min 1 · **median 3** · p90 7 · **max 61** |
| Items that would have NO example                        | **0**                                     |

Two readings matter.

**The pool is already the right shape.** Every one of the 144 items has at least
one candidate, and the median is 3 — this is not a feature waiting on more data.

**The tail is not.** One item carries 61 candidates. A section titled
ตัวอย่างงาน that renders 61 photos is a gallery, and a gallery answers a
different question than an example does.

---

## 2. Decisions

- **D1 — the default is DERIVED, not backfilled.** `get_wp_reference_photos`
  gains a fallback; no rows are written for it. A backfill is a point-in-time
  snapshot: WPs completed next month would need another one, and the
  empty-section problem returns the moment someone stops running it. A derived
  default covers every future completion for free.
  _Rejected, recorded:_ writing ~564 star rows now. It reads as "the PD curated
  this" when nobody did, and it makes `starred_by` a lie.

- **D2 — the candidate set is `after` / `after_fix` at the WP's HIGHEST rework
  round**, from WPs that are `complete` and mapped to the catalog item, not
  superseded. The rework-round filter is the correctness half: **on a WP that was
  sent back for defects, the original `after` photo IS the rejected work.** 10
  live WPs carry `after_fix` photos, so shipping without this filter would put
  defective work forward as the example for its work type. `during` and `before`
  are excluded — they answer "what happened", not "what does done look like".

- **D3 — cap 4, newest first.** Median is 3, so most items are unaffected and
  show everything they have; the cap exists for the 61-photo tail. **Unit: count
  of photos per catalog item, after the D2 filter** — not per WP, because several
  WPs across projects map to one item.

- **D4 — explicit stars are ADDITIVE, not a replacement.** Starred photos pin to
  the front, then derived picks fill the remainder up to 4. A PD who stars one
  good photo should not silently delete the other three examples; curation here
  is promotion, never erasure.

- **D5 — a PD can HIDE a photo, and hiding is a different act from un-starring.**
  Un-star removes a choice someone made. Hide suppresses a photo nobody chose.
  Both write to `wp_catalog_reference_photos`; a hidden row is excluded from the
  derived set and from the starred set alike, so hiding always wins.

- **D6 — ⚠️ the automatic picks are NOT world-readable; explicit stars stay so.**
  `get_wp_reference_photos` is world-readable by a spec 389 U5 decision, taken
  when the set was going to be a handful of hand-picked photos. It has never had
  consequences, because it has always returned nothing. Auto-population changes
  the premise: ~500 real site photos that no human selected would become readable
  without signing in. Operator's call, 2026-08-04: **split it.** A signed-out
  reader sees only what a human deliberately starred; a signed-in reader sees
  those plus the derived fill. This keeps 389 U5's _reasoning_ — unreviewed
  content does not leave the org — rather than its literal setting.

- **D7 — starred photos stay visibly starred.** The ⭐ marker renders on explicit
  stars only, so a PD can see what their curation did. Without it, starring is an
  action with no visible result whenever the photo was already showing.

---

## 3. The reader, stated precisely

`get_wp_reference_photos(p_wp_catalog_item_id uuid, p_include_derived boolean)`:

1. **Starred** — rows in `wp_catalog_reference_photos` for this item with
   `hidden_at is null`, newest first. Always returned.
2. **Derived** — returned only when `p_include_derived` (D6: the caller is
   signed in). Photos matching D2, excluding any whose `photo_log_id` has a
   `hidden_at` row, excluding any already returned as starred, newest first.
3. Concatenate, truncate to **4** (D3).

The signed-in decision is made by the CALLER (a Server Component that already
knows), not inside the DEFINER function — the function stays a pure projection
and the auth question stays where auth lives.

**A signed-out reader on an item with no explicit stars therefore gets nothing —
which is exactly today's behaviour for everyone, so it is a no-op for them, not a
regression.** The section must render its empty state rather than a broken frame,
and must NOT say "no examples yet" to a signed-out viewer when signed-in viewers
can see four: that copy would be false for the reader it is shown to. Same
wording as today's empty state, which was written for a genuinely empty set.

**Hiding is GLOBAL, and that is deliberate.** The catalogue is one shared
work-type registry, so a photo hidden for item X is hidden for every project that
maps to X — the same scope the existing ⭐ already has, since a star made on
project A's WP shows on project B's. `hidden_by` records who did it, so the act
is attributable. Anything narrower would need per-project reference sets, which
is a different (and much larger) feature.

---

## 4. Units

**U1 — schema + reader (schema lane).** `hidden_at timestamptz` + `hidden_by
uuid` on `wp_catalog_reference_photos`; `hide_reference_photo` /
`unhide_reference_photo` (PD tier, mirroring the existing star pair); the
`get_wp_reference_photos` replacement above. pgTAP:

- a starred photo returns for BOTH signed-out and signed-in callers;
- a derived photo returns ONLY when `p_include_derived` — the D6 pin, and the one
  a reader test cannot infer;
- **a positive control** — the derived arm returns something, so an empty result
  cannot be mistaken for a working filter;
- a photo from a WP at `pending_approval` is NOT derived;
- **an original `after` photo on a reworked WP is NOT derived** (D2's whole
  point), while its `after_fix` sibling is;
- a hidden photo is absent from both arms;
- the cap holds at 4 with 5 candidates;
- no EXECUTE for `anon` on the two writers, asserted with
  `has_function_privilege` (the house pattern).

**U2 — the surfaces.** `reference-photo-section.tsx` passes
`p_include_derived` from the session; the ⭐ toggle on `/review` gains
ไม่ใช้เป็นตัวอย่าง; starred photos carry the marker (D7).

Sequential: U1 → U2.

---

## 5. Acceptance — a fill rate, not a green suite

1. **ตัวอย่างงาน stops being empty.** Today 0 of 144 items render a photo. After
   U1 it should be 144 of 144 for a signed-in reader. Query the reader for a
   sample of items rather than trusting the suite.
2. **`wp_catalog_reference_photos` should stay near zero for a while.** It now
   fills only when a PD promotes or hides something. A month at 0 rows means the
   default is good enough and D4/D5 were cheap insurance; a burst of `hidden_at`
   rows means D2 is selecting badly and the filter, not the affordance, is what
   needs work.
3. **Re-read the per-item distribution before trusting the cap.** Median 3 is
   today's number; it moves as WPs complete. If the median passes 4 the cap is
   hiding the common case, not the tail.

---

## 6. Out of scope, recorded

- **Ranking the 4.** Newest-first is a placeholder for quality, which nothing in
  the schema models. If the operator wants "best" rather than "latest", that is a
  judgment the app cannot make and D4's star is the intended answer.
- **Cross-project leakage as a concept.** A reference photo is deliberately
  cross-project — that is the whole point of a catalogue. D6 bounds WHO sees it,
  not WHICH projects it spans.
- **Back-filling the 0 rows.** Explicitly rejected in D1.
- **The 61-photo item.** The cap makes it harmless; consolidating it is a
  catalogue-hygiene question, not this spec's.
