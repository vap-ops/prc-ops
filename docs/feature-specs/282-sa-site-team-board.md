# Spec 282 — SA site team board: on-site headcount + team structure at a glance

**Status:** 🎨 **DESIGN — OPEN DECISIONS (money-adjacent; needs an operator call, possibly counsel, on
the classification).** Build not started. Emerged from the spec-279 U6 brainstorm (2026-07-08) and was
deliberately split out of U6 because it is not a rendering change — it is a labor-cost/charge-attribution
feature.
**ADR:** TBD by §3 — approach A is code-only (no ADR); approach B introduces an arrangement-level billing
flag (schema + likely an ADR under 0060/0073).
**Origin:** operator, 2026-07-08 — "SA should tell at a glance the amount of people on site, separating
internal WP teams, external WP teams, and management team," plus two reminders that reshaped the model:
(i) "a subcon crew may contain some of our technicians — we charge from them"; (ii) "the opposite is also
true — a subcon crew may work as our temporary technicians, earning daily charges from us."

## 1. Problem & goal

The SA wants one glance: **how many people are on site, split into internal teams / external teams /
site-access (SA + owner)**, each expandable to its members. Today the `/sa/crew` ทีม view (U7b + U6) groups
the roster by crew and shows each crew's งาน + a ประจำ/ชั่วคราว badge — but it has no headcount total, no
internal/external split, no site-access bucket, and its cards do not collapse.

## 2. Why this is not a rendering tweak — the data reality

**Internal-vs-external is a property of the _arrangement_, not the team or the person** (operator's two
reminders). The same human is internal on Monday (we pay their day-rate → our labor cost) and external on
Tuesday (they work under a subcontractor, or our tech works in a subcon crew and we bill it → external
revenue). The classification = _who pays whom for this person's labor, on this WP, today_ — a
money-direction question.

Three facts make the naive "group crews by `kind`" wrong:

1. **Two disjoint person-models.** (a) `workers` + `crews`/`crew_members` — our roster; `workers.contractor_id`
   marks a worker's parent subcontractor (null = our company worker), `employment_type` is permanent/temporary,
   `crews.kind` is dc/subcon. (b) `subcontract_crew_members` (spec 258) — the subcontractor's OWN crew, a
   per-contract register of free-text names, **not** `workers`, with no day-rate/labor-log. "External teams"
   span both, and there is **no FK linking a `worker` into a subcontract crew slot** — so "our tech placed in
   a subcon crew, cross-charged" has **no representation today**.
2. **The fluid split lives in a ledger that is empty/unbuilt.** Who-pays-whom per person per WP per day is the
   labor-cost/charge ledger — `labor_logs` is 0 all-time and the charge side is ADR-0060 money-v2 (not built).
   So the true classification cannot be _derived_ today.
3. **Site-access needs a privileged read.** The ฝ่ายไซต์ bucket = `project_members ⋈ users WHERE role IN
(site_admin, site_owner)`. An SA can read `project_members` (staff-readable) but **not** other users'
   names/roles (`users` RLS = own-row-only). → a scoped `SECURITY DEFINER` read is required (danger-path).

## 3. THE KEY DECISION — how to classify internal vs external (operator / counsel)

The board's core ask hinges on this, and it has no clean derivable answer today. Options:

- **A. Team-nature approximation + person-level exception flags (recommended v1; mostly code-only).**
  Bucket by the _team's_ ownership: internal = our `workers` crews; external = subcontractor crews
  (`subcontract_crew_members`, and any `kind='subcon'` crew). Then annotate the cross-charges the operator
  flagged as **badges, without reclassifying the headcount**: a worker whose `contractor_id` disagrees with
  their team ("our tech on an external team" / a day-hired `employment_type='temporary'` subcon person on
  an internal team). Honest caveat: this approximates the fluid model; the true who-pays-whom split waits
  for the cost ledger. Delivers the operator's glance now.
- **B. Arrangement-level billing flag (the true model; schema, danger-path, ADR).** Record, when a person is
  placed on a crew/WP, a **billing direction** (`internal_cost` | `external_charge`), so the board classifies
  by the actual arrangement and the cross-charges are first-class. Correct and future-proof, but new schema +
  a capture UX + money-adjacent governance. The eventual fix; heavy for v1.
- **C. Defer the split; ship structure + headcount + site-access only.** The expandable board + total
  headcount + team grouping (by crew) + the ฝ่ายไซต์ bucket, **without** an internal/external cost split —
  add the split via B once the cost ledger exists. Safest; but omits the operator's headline ask.

**Recommendation:** **A for v1** — delivers the internal/external/site-access glance with honest
cross-charge annotations, mostly code-only (only the ฝ่ายไซต์ read is danger-path). Evolve to **B** when the
ADR-0060 cost engine lands and the cross-charge becomes a real money event worth capturing.

## 4. Board structure (independent of §3)

- **Total on-site headcount** at the top (assumed = roster composition on the SA's projects, not live
  attendance — confirm in §6).
- **Buckets** (per the §3 choice): **ทีมภายใน** · **ทีมภายนอก** · **ฝ่ายไซต์ (SA + owner)**, each with a
  subtotal; a **ยังไม่ได้จัดทีม** bucket for loose workers (from U7b).
- **Expandable cards** (`'use client'` — the one new interaction): collapsed = crew name + lead + count +
  the U6 งาน chips; tap → members with their level + employment/exception badges. VIEW-ONLY (moves are
  spec-279 U5).
- **ฝ่ายไซต์** resolved via a scoped `project_site_management(p_project)` `SECURITY DEFINER` RPC returning the
  `site_admin`/`site_owner` members (id + name) for a project the caller `can_see_project`.

## 5. Units (shape depends on §3; assuming A)

- **U1 — ฝ่ายไซต์ read.** `project_site_management(p_project)` definer RPC + pgTAP (gate on `can_see_project`;
  returns only site_admin/site_owner members; anon-revoked, 229 class). Schema/danger-path, operator-held.
- **U2 — the board.** Expandable cards + total + buckets + the ฝ่ายไซต์ section, reusing the U6/U7b
  `buildCrewTeams` shape. Code-only. Adds `'use client'` for collapse (justify in PR).
- **U3 (only if §3 = B) — arrangement billing flag** + capture. Separate schema unit + ADR.

## 6. Open items

1. **§3 classification (A / B / C)** — the load-bearing decision; operator, possibly counsel (money model).
2. **"On site" = roster composition or live attendance?** Assumed the former (who makes up the project's
   teams). If the operator means today's check-ins, that rides on spec-278 attendance (empty) — different feature.
3. **External-team member source.** `crews(kind='subcon')` (workers, but not populated via the lead-add RPC,
   which refuses subcon crews) vs `subcontract_crew_members` (the real subcontractor people). v1 must pick one
   or union them; today they are unlinked.
4. **Cross-charge as a money event.** The full "our-tech-in-subcon we charge" / "subcon-as-our-day-labor we
   pay" accounting is ADR-0060 money-v2, out of scope until the cost engine exists.
5. **Empty-roster reality.** Until เล็ก's real crews/subcontract crews exist, the board renders near-empty;
   value compounds as the onboarding + attendance loops fill.
