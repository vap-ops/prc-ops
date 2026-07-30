# Spec 383 — Equipment documents & expiries (เอกสารและวันหมดอายุของอุปกรณ์)

**Status:** ✅ decided 2026-07-30 — all four open questions answered (§8). U1 is
buildable; the two re-check-at-build-time caveats in §8 are not blockers.
**Origin:** operator, 2026-07-30 — _"each equipment may have warrantees, how do we
record that? explore other information we might have missed."_

---

## 1. Why now, and why this is time-critical

`equipment_items` is at **0 rows**. The registry was wiped on 2026-07-30 (spec 367
break-glass Procedure B) and the operator is about to re-type the fleet by hand,
with four photos per machine.

Every field added _after_ that refill costs a second pass over every physical
machine — someone walking the yard again with a phone. Every field settled
_before_ it costs one line on the typing sheet. This is the cheapest hour this
schema will ever have, exactly as spec 382's photo slots were (shipped at 0 rows,
no backfill, no half-documented fleet).

That timing is the whole argument for specifying this now rather than after the
refill.

## 2. Live grounding (queried 2026-07-30, not inherited)

**What `equipment_items` holds today** — all 21 columns:

```
id · category_id · owner_id · name · tracking · asset_tag · quantity · status
acquisition_cost · acquired_at · daily_rate · supplier_id · rental_agreement_id
brand · model · serial_no · condition · description · image_path · created_by · created_at
```

There is **no warranty field, no expiry of any kind, and no document attachment**
for equipment anywhere in the schema.

**What the four photo slots can and cannot do.** `equipment_item_photos` is a
closed `kind` enum (`item · nameplate · brand · qr_tag`) with `unique(item_id,
kind)` — deliberately a _completeness counter_, not a gallery (spec 382). It is
the wrong home for documents: a warranty card is not one of four fixed views of
a machine, and there can legitimately be several over an asset's life.

**⚠️ The storage bucket is images-only.** `equipment-images` declares
`allowed_mime_types = [image/jpeg, image/png, image/webp, image/heic]`, 25 MB.
**A supplier's PDF warranty cannot be stored there today** — it is rejected at the
bucket, before any policy runs. This is a real constraint on §3 D4, not a detail.

**★ The finding that reshaped this spec: the app already has this model.**

| Table                    | Shape                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company_document_types` | `code · name_th · name_en · hint · category_id · is_singleton · is_required · **requires_expiry** · sort_order · is_active` — **35 curated types live**, incl. `INS_VEHICLE`, `INS_CAR`, `LIC_ENGINEER_CORP`, `LIC_CONTRACTOR_REG` |
| `company_documents`      | `type_id · title · label · note · storage_path · **issued_at** · **expires_at** · superseded_by · created_by` — 10 rows live                                                                                                       |

Spec 331 also built the expiry-aware logic (`missingRequiredTypes` in
`src/lib/company-docs/registry.ts`), including the lesson that **an expired
document must not satisfy a requirement** — without that check a 6-month
certificate silently passes a checklist forever.

So the first draft of this spec — a bespoke `equipment_item_terms` table with a
hardcoded `warranty | inspection | insurance | registration` enum — was a
near-duplicate of a model this codebase already runs in production. It is
withdrawn in favour of D1 below.

## 3. Decisions

**D1 — mirror `company_documents` at ITEM scope; do not invent a new shape.**
New `equipment_document_types` (registry) + `equipment_item_documents` (rows).
Same column vocabulary, same supersede semantics, same `requires_expiry` flag.
A curated registry beats a hardcoded enum here for a concrete reason: the
operator will _discover_ types (a crane cert, a พ.ร.บ., a calibration slip) and
an enum costs a migration every time, while a registry row costs a form.
35 company types were curated exactly this way.

**D2 — renewals APPEND, they do not overwrite.** An annual inspection replaces
last year's via `superseded_by`, so the history of the obligation survives. This
matches `company_documents` and the house append-only instinct. "Current" = the
non-superseded row per type; expiry is read off that row.

**D3 — `requires_expiry` on the TYPE drives validation on the ROW.** A warranty
type demands an `expires_at`; a manual does not. One flag, no per-type code.

**D4 — 🔔 the bucket question is the one real fork.** A PDF cannot enter
`equipment-images`. Two honest options:

- **(a) new `equipment-docs` bucket** accepting `application/pdf` + the four image
  types. Procurement receives supplier warranties by email as PDFs, so this is the
  format the source material actually arrives in. Cost: one bucket + one policy.
- **(b) photograph the paper** into the existing bucket. Zero new infrastructure,
  and it matches the field reality (a phone, not a scanner) — but it silently
  degrades a PDF the operator already has into a photo of a screen.

✅ **DECIDED 2026-07-30: (a), a new `equipment-docs` bucket accepting
`application/pdf` + the four image types.** The documents that matter here
(warranty, insurance, inspection certificate) arrive as PDFs from third parties,
and (b) would make the system worse than the email inbox it replaces — it
degrades a file the operator already holds into a photograph of a screen. ⚠️ Whichever is chosen, the path
must stay **depth 1** — `<itemId>/<uuid>.<ext>` — because the live INSERT policy
arm matches on folder depth. One extra segment 403s everything with no code error
(spec 367 U5 / 370 lesson, paid twice already).

**D5 — NOT column-granted.** `equipment_items` is column-granted (money columns
walled, ADR 0055 d6) and copying that pattern by reflex onto a child table makes
PostgREST refuse the _whole_ read rather than hide a column — the spec 382
finding. Nothing here is money.

**D8 — ✅ procurement chases expiries, and this was settled by the SCHEMA, not by
preference.** The live `user_role` enum has **17 values and none of them is a
safety role** (`site_admin · project_manager · super_admin · project_coordinator ·
procurement · technician · hr · subcon_manager · accounting · visitor ·
contractor · project_director · client · procurement_manager · site_owner ·
auditor · legal`), so "the safety officer owns it" is not a buildable answer
today — it would need a new enum value, which needs an ADR (CLAUDE.md, Roles).
Procurement already curates the registry. If a real safety officer must own this
later, that is its own unit and a much larger one than U3.

**D6 — v1 is VISIBLE, not PUSHED.** An expiry chip and a list, no notifications.
A push channel for expiring certificates is a real want, but it needs an owner
and a cadence decision; shipping the visible layer first also proves anyone is
filling the data in at all (§7).

**D7 — the reader audience is the `/equipment` audience,** i.e. the same roles
that can see the registry. ⚠️ At build time, gate-check the exact live set the way
spec 381 had to — its history RPC needed `SECURITY DEFINER` on _both_ the write
and the read because `audit_log` excludes procurement and site_admin. Do not
assume this table inherits a convenient audience.

## 4. The seed type list — ✅ DECIDED 2026-07-30 (six ship, two dropped)

The operator asked what else we have missed. This is the answer in one table.
Each row becomes an `equipment_document_types` seed row.

**Ruling: seed the SIX below; `MANUAL` and `SERVICE_RECORD` are dropped from
v1.** The test each survivor passes is that it has either an **expiry** — so U3
gives it a deadline and a surface that nags — or a **named consumer** (the
purchase document is the evidence behind the PRI valuation). Manual and
service-record have neither: they are filing, and filing with no deadline does
not get done. The named precedent is spec 248's `answers_photo_id`, which holds
**0 of 2,712 rows** because it needed a curatorial act with no consequence
attached. A type nobody fills also dilutes the §7 fill-rate signal, which is the
one number that tells us whether any of this is working. Both are one registry
row away (U4) the day someone actually asks for them.

| Code           | ชื่อ                    | Expiry? | Why it earns a row                                                                                                                                                                                                                                     |
| -------------- | ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WARRANTY`     | ใบรับประกัน             | ✅      | The original ask. Warranty follows the asset — PRI will want it at transfer.                                                                                                                                                                           |
| `INSPECTION`   | ใบตรวจรับรอง (ปจ.)      | ✅      | Cranes, lifts, pressure vessels require periodic inspection by a licensed engineer in Thailand. ⚠️ **Confirm the exact forms and cadence with your safety officer — I am not asserting the legal detail.** Today nothing records an inspection at all. |
| `INSURANCE`    | กรมธรรม์ประกันภัย       | ✅      | Machinery insurance per asset.                                                                                                                                                                                                                         |
| `REGISTRATION` | ทะเบียน / พ.ร.บ. / ภาษี | ✅      | Road-registered plant (รถแบคโฮ, รถบรรทุก). `serial_no` and `asset_tag` do not cover a plate.                                                                                                                                                           |
| `CALIBRATION`  | ใบสอบเทียบ              | ✅      | Measuring instruments — a survey level or torque wrench out of calibration silently produces wrong work.                                                                                                                                               |
| `PURCHASE_DOC` | ใบเสร็จ / ใบกำกับภาษี   | ❌      | The source document behind `acquisition_cost` + `acquired_at` — i.e. the evidence for the PRI valuation. Ties into spec 380's doc-chase vocabulary.                                                                                                    |

⛔ **Dropped from v1 (see the ruling above):** `MANUAL` (คู่มือการใช้งาน) and
`SERVICE_RECORD` (ใบซ่อม / บำรุงรักษา). Neither carries an expiry or a named
consumer. Re-add as registry rows via U4 on request — no migration needed.

ⓘ `CALIBRATION` earns its row only if PRC owns measuring instruments (survey
level, torque wrench). Seeded anyway: the cost is one registry row and the
operator can deactivate it (`is_active = false`) without a migration, which is
exactly the flexibility D1 bought.

## 5. What we ALSO missed that is _not_ a document

Surfaced by the same sweep, deliberately kept out of this spec with a reason:

| Gap                                               | Verdict                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registration / plate number as a field**        | ✅ **IN, decided 2026-07-30** — nullable `registration_no` beside `serial_no`. A plate is an identifier you search by, not a document. The cost is asymmetric: one always-null column if PRC owns no registered plant, versus a **second walk around the yard** if it does, because the plate is readable exactly once — while someone stands in front of the machine typing it in. |
| **Hour meter / running hours**                    | The natural key for "when is the next service due", but `equipment_usage_logs` has **never had a row**, so there is no usage signal to hang it on. Own spec, after the scan-borrow flow has real data.                                                                                                                                                                              |
| **Responsible person while idle**                 | Movements say _where_, usage logs say _who borrowed_. Nobody owns an item at rest. Real gap; deferred — custody doctrine already assigns on-site materials to the SA.                                                                                                                                                                                                               |
| **`acquisition_cost` / `acquired_at` write path** | ⚠️ **Not new, and it BLOCKS the PRI transfer.** Both columns exist, both are money-walled, and `acquisition_cost` has **no write path in the app at all** — a DEFINER RPC is owed (spec 367 §10.4). The transfer schedule cannot be priced without it.                                                                                                                              |
| **Depreciation / book value**                     | Accounting's model, not the registry's. Out of scope.                                                                                                                                                                                                                                                                                                                               |

## 6. Units

- **U1 — schema.** `equipment_document_types` + `equipment_item_documents` +
  grants + RLS + the bucket decision from D4 + pgTAP. Seeds the §4 list.
- **U2 — the per-item เอกสาร sheet.** A fourth control in the row cluster beside
  ย้าย · แก้ไข · ประวัติ (the spec 381 U2 pattern), fetched on open. Add, replace
  (supersede), view.
- **U3 — the expiry surface. ⚠️ SHIPS IN THE SAME RELEASE AS U1+U2, not after.**
  A chip on the item row when something is expired or near it, plus a filtered
  list for procurement. Splitting it off would ship the half that removes the
  reason to use the feature — a document store with no deadline is a filing
  cabinet, and it is the nag that makes anyone put paper in it. (Doctrine §2: a
  half that removes a signal without adding one is not shippable. Here the
  "signal" is the only thing that drives the fill rate §7 measures.) Sequencing
  inside the release is free; the release boundary is not.
- **U4 — type registry editor** (optional), mirroring the company-doc-types
  settings screen so the operator can add a type without a migration.

## 7. Acceptance is a FILL RATE, not a green suite

```sql
select t.code, count(d.id)
  from equipment_document_types t
  left join equipment_item_documents d on d.type_id = t.id and d.superseded_by is null
 group by 1 order by 2 desc;
```

Zero `WARRANTY` rows a week after the refill means the field is not being filled
during the yard pass, and the answer is a nudge on the add-item sheet — not more
schema. The same query, restricted to rows with `expires_at < now()`, is the
number U3 exists to make visible.

## 8. Decisions taken 2026-07-30 — U1 is UNBLOCKED

All four open questions are answered; nothing in this spec now waits on the
operator.

| #   | Question             | Ruling                                                                                                          |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | The §4 type list     | **Six seeded**, `MANUAL` + `SERVICE_RECORD` dropped — each survivor carries an expiry or a named consumer (§4). |
| 2   | Bucket (D4)          | **New `equipment-docs`** accepting `application/pdf` + images.                                                  |
| 3   | `registration_no`    | **In** — asymmetric cost, and the plate is readable exactly once (§5).                                          |
| 4   | Who chases an expiry | **Procurement** — forced by the live enum, which has no safety role (D8).                                       |
| +   | U3 sequencing        | **Same release as U1+U2**, not a follow-up (§6).                                                                |

⚠️ **Two claims in this spec are deliberately NOT settled and must be re-checked
at build time, not inherited:**

1. **The ปจ. inspection forms and cadence are unverified.** §4 states them as a
   candidate, from general knowledge, not from law. Confirm with the safety
   officer before the seed text is written into a migration — a wrong Thai
   statutory label in a picker is worse than a generic one.
2. **The reader audience (D7).** Gate-check the live role set the way spec 381
   had to; do not assume this table inherits a convenient one.

Related: [[spec367-equipment-registry]] · [[spec381-equipment-item-history]] ·
[[spec382-equipment-photo-set]] · spec 331 (company documents — the model this
mirrors) · spec 380 (purchase-doc vocabulary).
