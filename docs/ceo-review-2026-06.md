# CEO review — prc-ops, June 2026

**What this is.** A business-level review of prc-ops written as if by the CEO,
produced 2026-06-13 alongside the spec-65 refactor. Method: three independent
executive analyses (product strategy, field operations, commercial/risk), each
grounded in the repo's own docs/ADRs/tracker, then each cross-examined by a
skeptical board-member pass that killed unrealistic moves and sharpened vague
ones. What survives is below. This document is advisory — it binds nothing
until items get their own specs/ADRs (same contract as
`architecture-revision-2026-06.md`).

---

## 1. What the company actually owns

Strip the stack away and prc-ops owns one thing: **the only trustworthy,
contemporaneous record of what happened on the construction site** — photos
that cannot be retroactively edited (triple-enforced append-only, supersede
with tombstones, originals never touched), approvals with full decision
history, purchasing facts with an audit principal on every write, and now
daily labor at per-WP granularity. The Thai phrase the docs use is the pitch:
**หลักฐานครบ แก้ย้อนหลังไม่ได้** — evidence complete, can't be edited after
the fact.

Everything maps against the work package (the operator's recorded doctrine:
scope/time/resource all hang off WP). That makes the WP record the unit of
value: evidence + approval + procurement + labor cost + (missing) billing
state, per WP. The PDF report is the artifact a contractor shows the project
owner **to get paid** — the product sits directly on the customer's cash
collection path, which is where pricing power lives.

Second asset: **build cadence.** Specs 32–65 shipped in roughly three days of
sessions, with a spec/ADR/test discipline that survives operator turnover of
context. That cadence is the company's actual unfair advantage and must not be
spent on speculative infrastructure.

## 2. The three threats, ranked

1. **Data loss is existential, not operational.** Every differentiating claim
   reduces to rows and Storage objects in ONE production Supabase project;
   migrations push straight to prod (ADR 0006); photos in Storage are NOT
   covered by Postgres PITR (architecture-revision §3.5 — still unaddressed by
   any ADR through 0042). One destructive migration or regional incident
   doesn't cause downtime — it falsifies the product's core promise for the
   pilot and every prospect they'd refer.
2. **Reversion-by-stall.** The notification pipeline is built but dark
   (checklist §8, ~15 min of operator console work, pending for days while 13
   design specs shipped). Labor logging is live but pays nobody yet; billing
   isn't in the app at all. Every hand-off still depends on someone
   remembering to open the app — so real coordination quietly stays in LINE
   group chats and paper, and the app decays into a photo album back-filled
   the day before billing. The append-only design cannot launder retro-entry:
   `captured_at` will show it. The moat erodes from disuse, not from any
   technical failure.
3. **Single-operator ops colliding with the first paid customer.** The
   docs/tests protect the _code_; nothing yet protects the _operation_ —
   promotions are raw SQL, incident response and console work run through one
   non-developer founder. The first unhandled outage at a paying customer
   destroys the pitch in a referral-driven market.

## 3. The moves (critique-filtered, sequenced)

### This week — operator console, zero dev

- **Activate LINE notifications** (go-live checklist §8): Messaging API
  channel, two Vercel env vars, two Vault secrets, pilots friend the OA,
  verify with ONE real push to a real phone the same day. This is the single
  highest value-per-effort item on the board and it is purely an operator
  task. Nothing else on this list matters as much until it's done — it flips
  the product from "dutiful" to "indispensable" and the engagement data gates
  later moves.
- **Verify the backup floor**: confirm the production project's PITR tier AND
  decide the Storage (photos bucket) backup posture. Hours, near-zero risk.

### Now — next dev sessions

1. **Labor P2** (already specced, C1–C7 operator-resolved): `wp_labor_costs`
   freeze at complete, PM cost view, photo-vs-log variance strip. The Head
   Tech surplus pilot — an internal _paying_ use case — waits on this.
2. **Billing status per WP/deliverable** (the displaced "spec 47" promise):
   status enum only (e.g. รอวางบิล/วางบิลแล้ว/เก็บเงินแล้ว), write path per
   the ADR 0042 RPC precedent, surfaced on WP detail + a report param.
   **Status only — no amounts.** Amount data inherits the C3 zero-grant
   posture if it ever comes, and full invoicing is explicitly resisted. The
   one operator decision to front-load: per-WP or per-deliverable (งวดงาน)?
3. **Procurement role onboarding** (1 small spec: requireRole + roleHome +
   tab set + /requests reach — ADR 0038 deferred exactly this). Then the
   ADR 0034 atrophy measurement runs on real usage. Honest note from the
   critique: with the 3 AppSheet column TODOs deferred indefinitely, AppSheet
   saves on touched rows already break — so the "measurement" is partly
   breakage-driven; the practical reading is simpler: get the real back-office
   person working in-app, watch for grid/bulk pain, demote AppSheet when the
   audit principal split says in-app won.
4. **Moat insurance, done as deliverables not as a checkbox**: (a) a restore
   DRILL — actually restore a point-in-time copy and open a photo from it;
   (b) Storage backup posture implemented; (c) preview-branch rehearsal for
   destructive/backfill migrations written into
   `docs/policies/change-management.md` as binding; (d) credential escrow
   (Supabase/Vercel/LINE/GitHub/Vault) with a named second person and a
   break-glass doc consolidating what already exists scattered (go-live §6,
   EMAXCONNSESSION note, cleanup procedure).

### This quarter

5. **Rehearsal instance #2 — before any customer is watching.** Clone the
   whole topology (Supabase project + migrations + buckets + pg*cron + Vault,
   Vercel project + env, fresh LINE Login + OA channels, WP import via the
   ADR 0014 contract) and write the spin-up runbook \_while doing it*. Triple
   duty: it is the migration rehearsal stage, the restore-drill target, and
   the future demo instance. Start on the free tier.
6. **Evidence pack export** — productize the moat: per-project/WP export of
   photos with client capture timestamps, approval decision history,
   supersede/tombstone lineage, plus content hashes computed at upload and a
   hash manifest. One Thai construction lawyer reviews the format and the
   claim language. Sell "tamper-evident contemporaneous record"; never claim
   "court-admissible" without the lawyer's sign-off. (Scope correction from
   critique: export the WP evidence chain, NOT raw audit_log — that's
   internal ops exhaust.)
7. **Platform diet**: pause Railway cron now (safe since the spec-39 reaper),
   delete the worker after a few weeks of clean fast-path history (it ignores
   spec-61 report params — a recorded correctness wedge, not just cost).
   Before instance #3 exists, script `db:push`/`db:types`/pgTAP across all
   linked instances.
8. **Capability-URL demand probe, not build**: the critique killed the 1–2
   week crew-upload build — the spec-23 token table is attachment-scoped (not
   a generic capability system) and no crew has asked. The cheap probe: one
   pilot foreman, one WP, one minimal token-validated upload route, watch
   whether photos actually arrive for two weeks. Build the real ADR only on
   evidence.

### Gated on a signed (or seriously engaged) customer #2

9. **In-app user/role admin** — ADR 0035 names it the productization
   prerequisite, but at one customer the promotion volume is a few SQL rows
   per quarter; premature now. It is the most security-sensitive write path
   in the schema (the role-escalation trap is documented in v2-handoff §4),
   so build it once, carefully, when the gate opens.
10. **Commercial packaging** (one unit, not separate "pricing" work): neutral
    per-instance brand surface (extend tenant-clean to PWA identity), the
    rehearsal clone seeded as demo, a one-page Thai pitch built around the
    evidence pack + LINE-native + sun-readable field UX, onboarding checklist
    derived from the go-live checklist. Pricing direction the panel converged
    on: **flat platform fee per instance + per-active-project; seats and
    reports unlimited** (per-seat contradicts the no-login crew doctrine;
    per-report taxes the customer's payday artifact). Validate the baht
    number in 2–3 contractor conversations against the real alternative —
    LINE chat + Excel is free, so sell against the cost of one lost payment
    dispute. Pilot #2 at cost, framed as founding-customer pricing.

## 4. What NOT to do (all three lenses agreed)

- **No org_id multi-tenant retrofit.** ADR 0035's re-open trigger (signed
  customer #2 AND projected instances past ~5) is the tripwire. The rework
  would be months of schema surgery against tables deliberately designed to
  resist modification, for zero customer-visible value — and it would
  dismantle a genuinely sellable line: "your evidence chain lives in your own
  database that nobody else's queries can touch."
- **No role sprawl.** hr/accounting/technician/subcon_manager surfaces stay
  unbuilt until procurement — in the enum since ADR 0008, still unreachable —
  is live and used. Crews and technicians never get logins (ADR 0033, spec 46
  C4): capability links or verbal reporting, not accounts.
- **No further visual re-skin rounds** beyond operator feedback tuning, no
  AppSheet bulk-grid parity ahead of measured demand, no spend analytics /
  line items / multi-project reports until a real customer asks. The recorded
  "on real demand" posture is correct.

## 5. The one-line version

Turn on the thing that's already built (LINE push), finish the loop that gets
the customer paid (labor cost → billing status), put a real floor under the
evidence (backups + restore drill + rehearsal instance), retire the platforms
that are already dying (Railway, AppSheet) — and spend nothing on
multi-tenant dreams until customer #2 signs. The moat is the data; insure it,
then sell it.
