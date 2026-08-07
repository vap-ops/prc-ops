# 402 — Notification message detail (รายละเอียดในข้อความแจ้งเตือน)

**Status:** draft · **Owner:** operator request 2026-08-07 · **Depends on:** nothing (code-only)

Operator, 2026-08-07: _"redesign notification details … push noti … information not sufficient."_
Scope decided in the same exchange: **all event types, one skeleton, a deep link on every push.**

---

## 1. The measured gap

Every outbox push is **plain text on both channels** — LINE `messages:[{type:"text"}]`
(`line-push.ts`) and Telegram `sendMessage` with no `parse_mode` (`telegram-push.ts`).
The Flex path exists but is wired only to the daily report (`daily-report/flex.ts`), and the
office tier is Telegram-bound, which has no Flex at all — so **the redesign must be a
plain-text skeleton that reads identically on both channels.** Rich bubbles are out of scope
and rejected for that reason, not overlooked.

Live `notification_outbox`, all-time, against what `composeNotification` actually renders:

| Event                     | rows    | message today                                        | carried but **discarded**                                         |
| ------------------------- | ------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `pr_progress`             | **878** | `คำขอซื้อ PR-287625 · ใบสั่งซื้อ PO-104: ส่งของแล้ว` | `item_description`, `transition[0]`, `requested_by`, `decided_by` |
| `wp_decision`             | 243     | `ผลการตรวจ WP-44-02: อนุมัติ`                        | WP **name**, project, decider name                                |
| `pr_created`              | 233     | PR ref + item + qty                                  | project, requester                                                |
| `wp_pending_approval`     | 229     | code + name + submitter                              | project                                                           |
| `pr_decision`             | 212     | PR ref + status label                                | `item_description`, decider                                       |
| `pr_cancelled`            | 57      | PR ref + reason                                      | `item_description`, canceller                                     |
| `feedback_submitted`      | 28      | type + role + title                                  | reporter **name**                                                 |
| `wp_evidence_resubmitted` | 24      | code + name                                          | project, resubmitter                                              |
| `wp_reopened`             | 2       | code + name + round                                  | project, reopener                                                 |

Two findings drive the design:

1. **`pr_progress` is 51% of every push ever sent** (~26/day in a normal month) and is the
   thinnest message in the catalog — a number and a status word. Its payload has carried
   `item_description` since the trigger was written; the composer never reads it.
2. **No event except `site_issue_reported` carries a deep link**, although the drain already
   imports `clientEnv` and builds one at `drain/route.ts:568`. A push today is a notification
   that you have work, with no way to reach it.

### 1.1 It is entirely code-only — verified, not assumed

The obvious reading is that thin messages mean thin payloads, i.e. trigger migrations and the
schema lane (held by #1008 at the time of writing). **False.** Every row already carries an id
that reaches the missing data:

```
event_type              n    work_package_id  purchase_request_id
pr_progress            878         0                 878
wp_decision            243       243                   0
pr_created             233         0                 233
wp_pending_approval    229       229                   0
pr_decision            212         0                 212
pr_cancelled            57         4                  57
wp_evidence_resubmitted 24        24                   0
wp_reopened              2         2                   0
feedback_submitted      28         0                   0   (payload.feedback_id)
```

100% coverage on every event. And the drain already builds `wpCodeById`, `wpProjectById`,
`projectNameById`, `displayNameById` and `poNumberByPrId` for other events — this spec widens
the id sets those maps are filled from, it does not add machinery.

**No migration. No schema-lane claim. Not blocked by #1008 or any other lane.**

---

## 2. The skeleton

Five slots, each dropped when absent, no dangling separators:

```
L1  <icon> <what happened>                what changed — the discriminator
L2  <the subject, in words>               item / WP name / feedback title — NEVER a bare number
L3  <project> · <refs>                    where it lives
L4  <actor> · <from → to>                 who, and what it moved from
L5  ความเห็น: / เหตุผล: <free text>          only when the user wrote one
L6  <url>                                 deep link, always, last
```

**L1 carries the discriminator on purpose.** A phone's LINE/Telegram notification shelf shows
one or two lines before truncating, so the status word must arrive first — burying it on L3
(as `pr_progress` does today) means the collapsed preview is indistinguishable between
`จัดซื้อแล้ว` and `ส่งของแล้ว`. **L6 is last** so the channel's link affordance sits at the bottom
rather than splitting the body.

### 2.1 Before → after, every event

**`pr_progress`** — 878 rows, the one that matters most

```
- คำขอซื้อ PR-287625 · ใบสั่งซื้อ PO-104: ส่งของแล้ว
+ 🚚 ส่งของแล้ว · คำขอซื้อ
+ เหล็กกล่อง กาวาไนซ์ ขนาด 3*1.5 นิ้ว หนา 2.3 มิล
+ <โครงการ> · PR-287625 · PO-104
+ จัดซื้อแล้ว → ส่งของแล้ว
+ https://…/requests/<purchase_request_id>
```

**`wp_decision`** — the largest lift; today it names neither the work nor the project

```
- ผลการตรวจ WP-44-02: อนุมัติ
+ ✅ ผลการตรวจ: อนุมัติ
+ งานติดตั้งเสากันชน
+ <โครงการ> · WP-44-02
+ ตรวจโดย คุณ…
+ ความเห็น: …
+ https://…/projects/<projectId>/work-packages/<workPackageId>
```

**`pr_created`**

```
+ 🆕 คำขอซื้อใหม่
+ ค้อนปอนด์ 8 ปอนด์ × 1 อัน
+ <โครงการ> · PR-329720
+ ขอโดย คุณ…
+ https://…/requests/<purchase_request_id>
```

**`wp_pending_approval`**

```
+ 🔎 งานรอตรวจ
+ งานจัดหาห้องน้ำชั่วคราว
+ <โครงการ> · WP-02-06
+ ส่งตรวจโดย คุณ…
+ https://…/review/work-packages/<workPackageId>
```

**`pr_decision`** `✅/⛔ คำขอซื้อ: <สถานะ>` · **`pr_cancelled`** `⛔ คำขอซื้อถูกยกเลิก` ·
**`wp_evidence_resubmitted`** `📸 ส่งตรวจอีกครั้ง` · **`wp_reopened`** `🔁 เปิดงานใหม่เพื่อแก้ไข (รอบ N)`
— all take the same six slots with their own L1 and link.

**`feedback_submitted`**

```
- ข้อเสนอแนะใหม่ (บั๊ก) จากผู้ดูแลระบบ: Date picker is in weird shape
+ 🐞 ข้อเสนอแนะใหม่ (บั๊ก)
+ Date picker is in weird shape
+ แจ้งโดย <ชื่อ> (ผู้ดูแลระบบ)
+ https://…/feedback/<feedback_id>
```

**`site_issue_reported`** and the two `receipt_correction_*` events have **zero rows** and are
brought into the skeleton for consistency only — `site_issue_reported` is already closest to it
and mostly needs re-ordering.

---

## 2.2 ⛔ REVERSED 2026-08-07 — there are NO deep links (U4)

U1–U3 shipped an L6 slot carrying a URL. **The operator refuted it the same day:**
_"sending a link is not helpful because users have pwa installed, links take them to browser,
not to mention login problem."_ Both halves are structural and neither is fixable from the
message, so U4 removed the slot, all seven link builders, and the drain wiring.

- **A push cannot reach the installed app.** LINE and Telegram open links in their own in-app
  WebView, and an **iOS home-screen PWA cannot capture a link at all** — there is no handoff.
  The field tier works in the PWA, so the link could never take them where the work happens.
- **That WebView has its own cookie jar**, so the tap lands logged out.
- **And the login round trip loses the destination**: `require-role.ts` does a bare
  `redirect("/login")` with no `next`, so even a successful login dumps the user at their role
  home rather than the thing the notification was about. That is a real app-wide bug — every
  gated link in the app has it — and is being fixed as its own unit, but it is not what makes
  the notification link worth keeping.
- **Per-channel links were considered and rejected.** The drain does push LINE and Telegram in
  separate loops, so a link could have been kept for the Telegram/office tier (4 people, desktop,
  usually signed in) and dropped for the LINE/field tier (19 people). The operator chose to drop
  them everywhere; two shapes of the same message is a maintenance seam that buys little.

**This also removed `site_issue_reported`'s pre-402 link** (spec 277's `issueDeepLink`) —
deliberate, not collateral: it has the same problem, and that event has zero rows all-time.

⚠️ **The information half is what answered the original ask** and is untouched. A message that
names the item, the project, the person and what changed does not need anything opened.
`tests/unit/notification-no-deep-links.test.ts` is exhaustive over the event enum so a new event
must decide this deliberately instead of inheriting a link by copy-paste.

## 3. Design decisions, and what was rejected

- **⛔ Do not render `priority`.** `pr_created`'s payload carries it and it looks like useful
  triage. Live distribution: **every single row is `critical`.** One value = the field is
  decorative, and a red word on 100% of pushes trains the reader to ignore it. Rejected
  deliberately — record it here so the next reader does not "improve" it back in.
- **⛔ No LINE Flex bubbles.** Telegram cannot render them and the office tier is Telegram-only,
  so Flex would give the _least_ reachable audience the _best_ message. One plain-text skeleton
  for both channels instead.
- **🚨 The deep link is ROLE-RELATIVE and getting it backwards 403s every recipient.**
  `/review/work-packages/[id]` is gated to deciders; `/projects/[pid]/work-packages/[id]` is the
  general surface. So:
  - `wp_pending_approval`, `wp_evidence_resubmitted` → **review** route (audience = deciders)
  - `wp_decision`, `wp_reopened` → **project** route (audience = the SA and the photo uploaders)
  - `pr_*` → `/requests/[requestId]`; `feedback_submitted` → `/feedback/[id]`
    Pin the route choice per event as a test, not a comment.
- **An unresolved name drops its whole line.** The existing `submitterName` arm already does
  this; keep it. Never render `โดย undefined`, and never a dangling `โดย`.
- **The icon map must cover the COMPLETE decision domain.** `approval_decision` is an enum;
  an icon table keyed by hand silently falls through when a value is added. Assert
  `Object.keys(ICON) ⊇ every enum value` so a new decision reds instead of shipping blank.
- **Compose stays PURE.** All resolution lives in the drain and arrives via `ComposeContext`;
  `composeNotification` remains a pure function over `(eventType, payload, context)`. The unit
  tests depend on that seam.

---

## 4. Units

**U1 — the skeleton + the purchase-request family** (1,380 of 1,706 rows = **81%**). Code-only.

- New `src/lib/notifications/message-skeleton.ts`: the six-slot builder + the deep-link
  builder, both pure. `composeNotification` composes through it.
- `ComposeContext` gains `projectName`, `actorName`, `deepLink` for the PR events.
- Drain: add `project_id` to the existing `purchase_requests` select (it is already read for
  `purchase_order_id` — one word); resolve `requested_by` / `decided_by` / `cancelled_by`
  through `displayNameById`.
- ⚠️ `displayNameById` is filled today only inside the site-issue leg. Widening it must not
  make PR-family names depend on that gate being non-empty — the identical latent-coupling bug
  is already recorded in the drain above `submitterIds`. Hoist the same way.

**U2 — the work-package family** (498 rows = 29%). Code-only.

- Drain: add `name` to the `work_packages` select; feed `wpProjectById` → `projectNameById` for
  WP events (the projects query already exists, its id set just needs widening); resolve
  `decided_by` / `reopened_by` / `resubmitted_by` names.
- This is where `wp_decision` finally names the work and the project.

**U3 — feedback + the dormant events.** Small. Reporter name on `feedback_submitted`;
`site_issue_reported` and both `receipt_correction_*` conformed to the skeleton.

---

## 5. Verification

- Unit: `tests/unit/compose-notification.test.ts` per event, before/after strings pinned.
  Mutation-check each — a source pin satisfied by an import line is the standing failure mode here.
- Drain: `tests/unit/drain-route.test.ts` — assert the enrichment maps are populated for the
  PR and WP legs **independently**, so neither depends on the site-issue leg running.
- **Gate 4 is a real push.** Compose is pure and jsdom cannot tell you whether a 6-line Thai
  message reads well on a phone shelf — send one of each family to the operator's own Telegram
  binding and look at it.
- ⚠️ **Acceptance is weak and should be stated as weak.** Route views on `/requests/[requestId]`
  and `/review/work-packages/[id]` should rise once the links are tappable, but in-app navigation
  lands on the same routes, so the signal is not clean. The honest acceptance test is the
  operator reading a week of pushes and saying whether the question "what is this about?" still
  needs the app to answer it.
