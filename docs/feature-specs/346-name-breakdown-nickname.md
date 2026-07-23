# Spec 346 — structured names: prefix · first · last · nickname (nickname as the app's display name)

**Status:** decisions locked in chat 2026-07-22/23; spec written 2026-07-23. Build
not started.
**Origin:** operator, mid-onboarding walkthrough — "first and last name should
not be in the same field, and prefix should be selection", then "+ nickname",
then "Option C, with nickname addition" and "let admin fix that until we have a
clean database."
**Numbering:** 346, not 344/345 — both were claimed by concurrent lanes
(344 catalog dedup, 345 accounting-payment audit) while this was being designed.
**Related:** [343 registration completion](343-registration-completion-cliff.md) ·
[321 profile-edit standardization](321-profile-edit-standardization.md) ·
identity-change flow (specs 317/321)

---

## 1. The problem, from live data (rechecked 2026-07-23)

A person's name lives in ONE free-text column, `full_name`, on three tables
(`users`, `staff_registrations`, `crew_registrations`). No `first_name`,
`last_name`, `name_prefix`, or `nickname` column exists anywhere. Consequences:

- **The registration form asks for a whole name in one field.** The operator
  wants prefix as a selection and first/last separate.
- **`users.full_name` is not a legal name.** 40 rows: **22 are a single token**
  (e.g. "Naruee", "เล็กครับ") and **0 carry a Thai prefix** — these are LINE
  display handles (there is an `update_my_display_name(p_full_name)` RPC whose
  whole job is editing this string). A surname cannot be derived from "เล็กครับ".
- **`staff_registrations.full_name` is structured** — 20 rows, 0 single-token,
  every one has a space; a few carry a glued-on prefix (`นางสาว สังวาลย์ มาลา`).
- **Nicknames already ARE the working identity and have nowhere to live** — they
  are jammed into `contractors.name` in parentheses (ช่างอวย, ช่างสุทิน, ช่างโก).
- `full_name` is read in **144 places across 45 files** in `src/`.

## 2. Locked decisions

1. **Option C — structured parts become the truth; `full_name` is eventually
   retired.** NOT a lossy string-split backfill: parts start NULL on legacy rows
   and a human who knows the person fills them in ("let admin fix that until we
   have a clean database").
2. **Nickname becomes the app-wide display name.** Rosters, badges, muster,
   approval lines show ชื่อเล่น; the legal name (prefix + first + last) is
   reserved for contracts and payroll.
3. **Admin cleanup authority, keyed on the STRUCTURED parts:**
   - `first_name`/`last_name` NULL → admin writes them **directly** (filling a
     gap, not altering an identity — this is what makes clearing ~40 accounts
     feasible).
   - already set → the edit routes through the existing approval flow
     (`submit_identity_change` / `decide_identity_change`) — the two-person rule
     stays where the risk is.
   - ⭐ **The direct arm allows NULL → value ONLY.** Never value→value, never
     value→NULL, or an admin clears the fields then "fills the gap", bypassing
     approval in two taps. Enforced in the RPC, not the UI.
   - **Nickname is exempt from approval** — a display alias, not legal identity.
     Editable by an admin or the person themselves.
4. **`full_name` is NOT dropped on day one** — it is the legacy fallback while
   cleanup runs (dropping it first blanks 22 accounts). Retired only once the
   database is clean (U6, gated).
5. **A cleanup surface is required** — a count of who still lacks structured
   parts, worked down by admins. Self-closing: once every row has parts, every
   future edit is approval-gated automatically, no flag to flip.

## 3. ⭐ OPEN CRUX — resolve before building U5 (the approval arm)

The locked decision #3 says "already-set names route through
`submit_identity_change` / `decide_identity_change`." But that flow, **live
today**, is built on a single string:

```
submit_identity_change(p_full_name text, p_national_id text, p_dob date)
identity_change_requests(proposed_full_name text, proposed_national_id, proposed_dob, …)
```

It proposes and approves a `full_name` STRING, not structured parts. Routing a
structured-name edit through it needs one of:

- **(A) Extend the approval flow with structured columns** — add
  `proposed_name_prefix_id` / `proposed_first_name` / `proposed_last_name` to
  `identity_change_requests` and re-signature `submit_identity_change`. The
  approver sees and approves the actual parts. Faithful to "parts are the truth",
  but it touches a sensitive, already-shipped identity-approval surface (specs
  317/321) — more schema and a re-signature.
- **(B) Compose the parts into `proposed_full_name`** and let the existing flow
  approve the string; on approval, re-split into the columns. Cheaper, no
  re-signature — but the approver approves a composed string, and the re-split is
  the exact lossy operation decision #1 rejected.

**Recommendation: (A).** The whole spec exists because a name is not one string;
approving it as one reintroduces the bug. But it is the larger change and touches
a danger-path surface, so it is an explicit operator decision, not mine to pick.
**U5 is BLOCKED until this is answered.** Nickname edits (no approval) and the
NULL→value direct arm (U4) do NOT depend on it and can ship first.

## 4. Schema shape (proposed; U1)

**Prefix = a lookup table, NOT an enum.** Thai prefixes are an open set
(นาย · นาง · นางสาว · ว่าที่ร้อยตรี · ดร. · …); an enum trips the exhaustiveness
guards on every addition (CLAUDE.md Roles note) and needs an ADR to grow. The
codebase has repeatedly chosen a lookup table for exactly this shape —
departments (spec 284, label-only open data), company_document_types (spec 331),
work_categories. Follow that house pattern:

```
name_prefixes(id uuid pk, label text unique not null, sort_order int, is_active bool default true)
  -- seeded: นาย, นาง, นางสาว  (+ operator adds more via a settings editor later)
```

New columns, **all nullable**, on `users`, `staff_registrations`, and
`crew_registrations` (crew inclusion is an open question, §7):

```
name_prefix_id uuid null references name_prefixes(id)
first_name     text null
last_name      text null
nickname       text null
```

`full_name` stays (decision #4). No backfill in U1 — legacy rows keep NULL parts
until a human fills them.

## 5. Display resolution (U3)

Two derived values, one helper module, so every surface agrees:

- **`displayName(row)` = `nickname` ?? `composedLegal(row)` ?? `full_name`** —
  used by rosters, badges, muster, approval lines, e-card, everywhere a person is
  named on screen. Nickname wins (decision #2).
- **`legalName(row)` = `composedLegal(row)` ?? `full_name`** — used by contracts,
  payroll, WHT, and anywhere a legal identity is required. Never the nickname.
- `composedLegal(row)` = `[prefix.label, first_name, last_name]` joined on a
  space, or `null` if first+last are both empty.

Because both fall back to `full_name`, a legacy row with NULL parts renders
exactly as it does today — the screens improve per-row as cleanup fills them, and
nothing ever renders blank.

## 6. Units

Each carries negative cases · exact Thai strings · recovery, per the binding
spec template.

### U1 — SCHEMA (operator-held danger path)

`name_prefixes` lookup + seed (นาย/นาง/นางสาว) + the 4 nullable columns on the
three tables. Additive only; no backfill, no `full_name` change.

**Negative cases**

| mode                                               | Thai string                                                                               | recovery                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A prefix row referenced by a person is deactivated | none — `is_active=false` hides it from the picker; existing FK rows keep resolving        | The label still renders (FK intact); it just cannot be newly selected. |
| Duplicate prefix label inserted                    | `มีคำนำหน้านี้อยู่แล้ว` (unique violation, surfaced by the settings editor when it lands) | Edit the existing row instead.                                         |

**RED-first:** pgTAP — the columns exist and are NULLABLE; the seed has exactly
the 3 prefixes; a person row with NULL parts is legal.

### U2 — the registration form asks for structured names

Replace the single ชื่อ-นามสกุล input on the fresh + pending registration form
(`StaffRegistrationForm`) with: **คำนำหน้า** (select from `name_prefixes`),
**ชื่อ**, **นามสกุล**, **ชื่อเล่น**. On submit, write the four columns AND compose
`full_name = composedLegal` (keep `full_name` populated through the transition,
decision #4). This is the operator's original ask.

**Negative cases**

| mode                                                                       | Thai string                                                                                                  | recovery                                                                                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ชื่อ or นามสกุล blank on a fresh mint                                      | `กรุณากรอกชื่อและนามสกุล`                                                                                    | Inline; submit stays disabled (mirrors the current `กรุณาระบุชื่อ-นามสกุล` floor).                                                                              |
| No prefix picked                                                           | none — คำนำหน้า is optional (many workers have none)                                                         | Compose without it.                                                                                                                                             |
| ชื่อเล่น blank                                                             | none — optional; display falls back to the legal name                                                        | —                                                                                                                                                               |
| Legacy pending row has `full_name` but NULL parts (a row minted before U2) | none — prefill first/last from `full_name` split as an EDITABLE SUGGESTION only, never written back silently | The applicant confirms/corrects, then a real save writes the parts. The split is display-only until confirmed (never the silent backfill decision #1 rejected). |

New strings on 2+ surfaces → `labels.ts`.

**RED-first:** the four inputs render; a blank first/last blocks a fresh mint;
submit composes `full_name` from the parts.

### U3 — display resolution helper, applied at the top surfaces first

Add `displayName` / `legalName` / `composedLegal` (pure module, unit-tested) and
apply `displayName` at the **highest-leverage** naming surfaces — muster, the
roster, badges, the approval/review lines — NOT all 144 sites at once. Contracts
/ payroll / WHT switch to `legalName`. Remaining read sites migrate in follow-up
passes (tracked, not silently skipped).

**Negative cases**

| mode                                                                                    | Thai string                                                     | recovery                                                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Row with NULL parts AND NULL full_name (should not exist — full_name is NOT NULL today) | render `—`                                                      | Defensive only; no such row exists.                                                |
| Nickname set but legal parts NULL                                                       | display shows nickname; legal surfaces fall back to `full_name` | Correct by design — nickname is display, legal name is the fallback until cleaned. |

**RED-first:** `displayName` prefers nickname; falls back composed→full_name;
`legalName` never returns the nickname. Mutation-check the fallback order.

### U4 — admin cleanup surface + the NULL→value direct arm

A list (own admin surface, NOT `/settings/integrity` — a legitimately-empty
legacy row is not an invariant VIOLATION, and an always-amber board trains people
to ignore it, per the spec-341 lesson) showing rows whose structured parts are
incomplete, with a direct editor. New RPC `fill_structured_name` that writes
prefix/first/last **only when they are currently NULL** (NULL→value), and
nickname freely (no approval). Never value→value (that is U5's approval path),
never value→NULL.

**Negative cases**

| mode                                                               | Thai string                                                          | recovery                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------- |
| Admin tries to CHANGE an already-set first/last via the direct arm | `ชื่อนี้ถูกกรอกแล้ว การแก้ไขต้องผ่านการอนุมัติ` (42501 from the RPC) | Use the approval flow (U5). The direct arm is fill-only. |
| Admin sets a part to blank                                         | `ชื่อและนามสกุลต้องไม่ว่าง` (the RPC rejects value→NULL)             | Enter a value, or leave it untouched.                    |
| Non-admin reaches the surface                                      | route/RPC role gate refuses (mirror the identity-admin gate)         | —                                                        |
| Nickname edit on an already-named row                              | allowed, no approval (exempt)                                        | —                                                        |

**RED-first:** pgTAP — NULL→value succeeds; value→value raises 42501;
value→NULL rejected; nickname value→value succeeds. Mutation-check each arm.

### U5 — the approval arm for already-set names (BLOCKED on §3 crux)

Route a change to an already-filled legal name through the identity-change flow.
**Do not build until the operator answers §3 (extend the flow vs compose).**
Shape depends entirely on that answer.

### U6 — retire `full_name` (gated, far future)

Once the cleanup surface (U4) reports zero rows missing structured parts, drop the
`full_name` fallback from `displayName`/`legalName`, then the column. **Gated on a
clean database — do not schedule.** Destructive migration → operator-held,
break-glass Procedure B.

## 7. Open questions

- **§3 crux** (extend the approval flow vs compose) — blocks U5. Operator call.
- **The prefix set** — seed is นาย/นาง/นางสาว; does the operator want
  ว่าที่ร้อยตรี / ดร. / etc. seeded now, and is an "อื่นๆ" free-text escape
  allowed (it would reintroduce free-text into the very field we structured)?
- **`crew_registrations`** — same treatment as `staff_registrations`, or defer?
  (0 rows use it in the current flow; confirm before spending U1 schema on it.)
- **The 144 read sites** — U3 does the top surfaces; the tail is a tracked
  migration, not a silent cap. Name the surfaces explicitly in the U3 plan.

## 8. Non-goals

- **No lossy string-split backfill.** Legacy rows keep NULL parts; humans fill
  them (decision #1). The U2 "prefill from full_name" is an editable suggestion,
  never a silent write.
- **No `full_name` drop on day one** (decision #4).
- **No enum for prefixes** — a lookup table, per the house pattern (§4).
