# Architecture Revision — June 2026 (entrepreneur lens)

**Status:** advisory. Nothing here is binding until the operator signs
off and each adopted item gets its own spec + (where architectural) ADR.
**Audience:** the operator + future build sessions. Read after
`docs/v2-handoff.md`.

**Brief:** "Revise the architecture of this app. Think like an
entrepreneur, not just technical. Figure out what can be improved."

This doc therefore judges the architecture by business criteria —
cost per month, ops burden per change, time-to-value for users,
sellability, moat — not by code aesthetics. The codebase itself is in
good shape; the findings below are about **edges and strategy**, not a
rewrite.

---

## 1. What this app actually is (business framing)

A Thai-first, LINE-native field-operations platform for construction
contractors: photo evidence (append-only, audit-grade), work-package
approval workflow, purchasing with delivery tracking, and PDF reports —
the artifact a contractor shows the project owner to get paid.

Today it serves one company (PRC) on two pilot projects (~162 WPs).
The operator is a non-developer running builds through Claude sessions.

**The latent product hypothesis:** mid-size Thai contractors need
evidence-grade site documentation and purchasing visibility, and the
incumbents (Procore, Fieldwire, etc.) are English-first, heavy, and
priced for Western GCs. A Thai-first, LINE-native, sunlight-readable
tool that produces dispute-proof evidence chains is a real niche. The
architecture decisions below are evaluated against _both_ futures:
internal tool forever, and productized SaaS.

**The moat, if there is one, is the data discipline already built:**
append-only photo logs + audit trail = a tamper-evident evidence chain
("หลักฐานครบ แก้ย้อนหลังไม่ได้") that a spreadsheet or LINE group chat
can never offer. Everything below protects or compounds that.

---

## 2. What is right and must not change

- **Supabase + Next.js core.** One database, RLS on every table,
  centralized role helper, typed clients. Correct for a 1-person ops
  team; correct at 50 customers too.
- **Append-only / supersede / triple-enforcement.** This _is_ the
  product (evidence-grade). Never trade it for convenience.
- **Thai-first UI, sun-readable theme, bottom tabs, PWA.** The field
  UX work of specs 14–31 is the part users touch; it is the demo.
- **TDD + spec-per-unit + ADR discipline.** With a non-developer
  operator, the docs/tests ARE the bus-factor mitigation. Keep.
- **LINE Login.** 100% of the user base lives in LINE. Right call.

No rewrite, no framework change, no "microservices". The revision is
about the three edges below.

---

## 3. Strategic liabilities, ranked

### 3.1 AppSheet is rented ground — stop investing, plan the sunset

AppSheet is a second front-end, owned by Google, coupled raw to the
production schema via the `appsheet_writer` DB role.

What it costs today:

- **Every schema change taxes the operator twice.** Migration + app
  code is automated; the AppSheet column config is manual. Right now
  there are TWO standing blocking TODOs (mark `pr_number` +
  cancellation columns read-only; expose `shipped_at`) — and saves
  _break_ until they're done. This tax scales with every future spec
  (suppliers, line items, partial deliveries all touch PR columns).
- **A manual regression ritual per change** (Tier-2 smoke) that only
  the operator can run.
- **A production incident already** (EMAXCONNSESSION pooler
  exhaustion, 2026-06-11) caused by AppSheet's sync behavior meeting
  Supavisor's per-role session cap.
- **Per-user licence fees** at scale (order of US$5–10/user/month on
  current published tiers — verify before any decision) — and it is
  unsellable: "our back office is a Google AppSheet you must also
  configure" kills the SaaS story.
- **The next roadmap items deepen the coupling.** ADR 0029 (AppSheet
  image bridge: capability-URL route handler + virtual columns) is
  unwritten and unbuilt — it exists _only_ to show in-app photos
  inside AppSheet. The suppliers table would need AppSheet config too.

What AppSheet actually provides that the app lacks: a **write surface
for purchase/delivery facts** (supplier, order date, ETA, shipped
date) and a grid-style bulk view. That is roughly 2–3 specs of in-app
work, because the hard part is already done: ADR 0025's derive trigger
converts facts → status _regardless of who writes the facts_, and the
`procurement` role has been in the enum since ADR 0008 waiting for
exactly this.

**Recommendation:**

1. **Cancel the P3 AppSheet image bridge** (ADR 0029) before it is
   written. Once procurement works in-app, the bridge is pointless —
   they see the photos in the app. This deletes a whole unit of
   planned work and the token table already live for it becomes the
   seam for §3.6 (capability URLs for crews) instead.
2. **Build the in-app procurement surface** (the "บันทึกการสั่งซื้อ /
   บันทึกการส่งของ" forms on `/requests`, gated to
   `procurement`/`super_admin`, writing the same fact columns through
   a SECURITY DEFINER RPC or RLS policies — new ADR amends 0025).
   Build the suppliers table (already queued) **in-app from day one,
   never in AppSheet**.
3. **Demote AppSheet to read-only viewer** during transition (write
   path off = no more blocking column-config TODOs, no more Tier-2
   write smoke), then retire it when the operator stops opening it.

This is the single highest-leverage architectural change available:
it removes a recurring operator tax, an incident class, a licence
cost, and a sale-blocker, and it replaces planned work (bridge) with
less total work (forms).

### 3.2 No notifications — the engagement leak

Every flow in the app is a hand-off: SA uploads → **PM must notice**;
PM decides → **SA must notice**; PR approved → **back office must
notice**; goods on route → **site must notice**. Today "notice" means
"open the app and poll". On a construction site, nobody polls — the
operator's own reports show flows stalling until someone happens to
look.

The users are 100% LINE-identified (`line_user_id` is already on every
user row). **LINE push messages are the single feature that makes this
app indispensable rather than dutiful** — the WP approval arrives in
the same place their family chat does.

Architecture (small, fits existing patterns):

- `notification_outbox` table, written by the same trigger family that
  already writes `audit_log` on every status transition — the events
  are _already being detected_, they're just not being delivered.
- A drainer that calls the LINE Messaging API push endpoint, marks
  rows sent. Where it runs is a §3.3 decision (route handler cron /
  Edge Function — not a new platform).
- Needs a LINE **Messaging API** channel (separate from the Login
  channel) and users adding the OA as friend — one-time onboarding
  step, fits the existing go-live checklist pattern. Verify current
  free-tier message quota for Thailand before the spec; budget
  per-message cost beyond it (it is small against the value).
- Web Push (PWA) can be the free fallback later; LINE first — that's
  where the users are.

Already in the iteration queue as "LINE notification unit" — **promote
it to the next feature slot.** It compounds every workflow shipped in
specs 21–31.

### 3.3 Three platforms for two moving parts — consolidate when touched

Vercel + Supabase + Railway = three dashboards, three env-var sets,
three billing relationships, three failure surfaces — for a one-person
ops team. Railway exists to run one feature: PDF generation on a
5-minute poll (24/7 cron against a usually-empty queue; PM waits up to
5 minutes for a report).

PDFKit + the Sarabun font (spec 13) run fine in a Node runtime. The
options, in order of preference:

- **(a) On-demand route handler** — PM clicks "generate", the report
  builds in-request, seconds not minutes. Risk: large multi-photo
  reports vs serverless duration/memory limits — spike it with the
  biggest real report before committing.
- **(b) Supabase Edge Function + pg_cron/queues** — keeps async shape,
  kills the platform. Deno port of the PDF code is the cost.
- **(c) Keep the worker, replace cron-polling with a webhook trigger**
  — smallest change, still three platforms.

Not urgent (Railway is cheap and works; cron can simply be paused
between reporting periods). **Do it as part of the notification unit
or the next time the worker needs a change anyway** — the drainer in
§3.2 needs a home, and choosing (a)/(b) means Railway's last reason to
exist goes away. End-state: two platforms, one bill each.

### 3.4 Tenancy is being decided by default — decide it on purpose

The schema is single-tenant. The moment customer #2 appears, there are
two roads:

- **(A) Instance-per-customer:** clone Supabase project + Vercel
  project per customer. Maximum isolation, zero schema work, ops
  burden linear in customers. Fine for 2–5 customers.
- **(B) Multi-tenant:** `organizations` table + `org_id` on root
  entities, RLS extended via the existing centralized helper pattern.
  Cheap _now_ (162 WPs to backfill), expensive later.

**Recommendation: choose (A) explicitly for now, and buy insurance:**
keep the codebase tenant-clean (no PRC-specific hardcoding in code or
copy — project names/codes stay data), and write a one-page
"spin up a new instance" runbook as instances are touched. Re-open (B)
only when a real second customer signs and instance count is projected
past ~5. Record the choice in a short ADR so future sessions stop
re-deriving it.

What productization _does_ require regardless of (A)/(B), and is
already on the backlog: **in-app user/role admin** (today promotion is
a SQL UPDATE only the operator can run — no customer can self-operate)
and profile management (done). Pull role admin forward once a second
real deployment is plausible.

### 3.5 One database, no rehearsal stage — pilot-killing risk class

Migrations push straight to the production DB (ADR 0006 dropped local
Docker deliberately, and the pgTAP suite is strong). But with real
pilot data and append-only triggers, a destructive mistake is
_designed to be hard to undo_. Cheap mitigations, in order:

1. **Rehearse destructive/backfill migrations on a Supabase preview
   branch or scratch project** (free tier suffices) before `db:push`.
   Make it a checklist line in the migration policy, not a new
   platform.
2. **Confirm PITR / backup tier** on the production project matches
   the value of the pilot data (photos in Storage are not covered by
   Postgres PITR — check Storage backup posture too).
3. CI gap, smaller: CI runs lint/typecheck/unit only; pgTAP and e2e
   are local-honor-system. At minimum, gate pushes touching
   `supabase/` on a green local `db:test` by convention (already
   practiced; write it down).

### 3.6 Field reality gaps that are also product features

- **Offline / weak-signal upload queue.** Sites have bad connectivity;
  today a failed upload is a retake (or lost evidence). A PWA
  background-sync queue ("ถ่ายตอนนี้ ส่งเมื่อมีสัญญาณ") is both a UX fix
  and a headline selling point. Medium effort — own spec, after
  notifications.
- **Capability URLs for contractor crews.** ADR 0033 established that
  WPs are executed by outsider crews _without logins_. The
  capability-token table built for the (now-cancelled) AppSheet bridge
  is the natural seam: a crew foreman gets a LINE-shared link to
  upload progress photos for exactly one WP, no account. That turns
  the licence-free workforce into data contributors — a feature no
  per-seat-priced incumbent will copy. Park it as a v2 candidate;
  needs its own security ADR (token TTL, scope, abuse).
- **Photo size discipline.** Originals are sacred (ADR 0003), but
  unbounded phone-camera uploads will dominate Storage cost and choke
  site uplinks. Client-side downscale to a sane evidence resolution
  (e.g. ~2000px long edge) _before_ upload is compatible with the
  "stored unmodified" invariant if the downscaled file IS the
  original we store. Decide consciously; record in an ADR either way.

### 3.7 Housekeeping (cheap, do opportunistically)

- Dormant `owner_id` + `work_package_members` (superseded by ADR 0033) — drop in a v2 cleanup migration.
- Orphaned `/requests?wp=` pinned mode (spec 29 seam) — remove.
- `fetchAssignableStaff` unused by pages — keep only if a user picker
  is actually coming.
- Stale-`processing` report reaper (known gap) — fold into whatever
  §3.3 lands on.
- Iteration-9 queue items (tap targets, length caps, client typing)
  remain valid; none are strategic.

---

## 4. Revised target architecture (end-state picture)

```
LINE (login + push notifications + share-links)
        │
Vercel ── Next.js app — ALL roles in-app:
        │   SA · PM · procurement · super_admin · (crew capability links)
        │   on-demand PDF generation (or Edge Function)
        │   notification outbox drainer
        │
Supabase ─ Postgres (RLS, append-only evidence chain, derive triggers,
        │            notification_outbox) + Auth + Storage
        ×
   (Railway retired · AppSheet retired)
```

Two platforms, one app, every role first-class, push instead of poll.
Nothing in the core changes; the edges fold inward.

---

## 5. Prioritized roadmap (impact ÷ effort, entrepreneur ordering)

**Phase 1 — make it indispensable (next iterations)**

1. **LINE notification outbox** (§3.2) — biggest daily-value win;
   compounds everything already shipped. Includes choosing the
   drainer's home (starts §3.3).
2. **In-app procurement surface v1 + suppliers table** (§3.1) —
   record purchase/delivery in-app; AppSheet write path goes
   read-only; cancel ADR 0029 bridge. Removes the operator tax.

**Phase 2 — harden and simplify**

3. PDF generation on-demand; retire Railway (§3.3).
4. Offline-tolerant photo upload queue (§3.6).
5. Migration rehearsal stage + backup-tier check (§3.5).
6. Dormant-schema cleanup migration (§3.7).

**Phase 3 — productization (trigger: second customer becomes real)**

7. Tenancy ADR — instance-per-customer now, runbook written (§3.4).
8. In-app user/role admin (replaces SQL promotion).
9. Crew capability-URL uploads (§3.6).
10. Spend analytics / line items / partial deliveries — only on real
    demand (per existing posture), but note they become a paid-tier
    story once suppliers + line items exist.

**Explicitly cancelled / deprioritized:**

- ADR 0029 AppSheet image bridge — cancelled by §3.1 (decision
  needed from operator).
- Any further AppSheet column additions — frozen pending §3.1
  decision.
- Multi-tenant schema work — deferred with insurance (§3.4).

---

## 6. Decisions requested from the operator

1. **AppSheet sunset** (§3.1): approve direction? (Cancel bridge,
   build in-app procurement, AppSheet → read-only → retired.) This
   changes where the back office lives, so it is the operator's call,
   not a session's.
2. **Notifications next** (§3.2): confirm the LINE notification unit
   takes the next feature slot, and that creating a LINE Messaging
   API channel (operator console task) is acceptable.
3. **Tenancy posture** (§3.4): confirm instance-per-customer-for-now
   so it can be recorded in an ADR.
4. **Photo downscale** (§3.6): comfortable storing a downscaled
   original as THE original, or keep full camera resolution and pay
   the storage/uplink cost?

Each approved item proceeds through the normal loop: numbered spec →
ADR where architectural → test-first build → tracker entry.
