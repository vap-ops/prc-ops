# Progress tracker

Tracks feature units per the workflow in `CLAUDE.md`. One section per unit.

> **Older history is archived.** Units before Spec 21 live in [`progress-archive.md`](progress-archive.md), kept out of this file to save context. This file holds Spec 21 onward.

---

## Spec 21 - urgency segmented control (2026-06-11)

Status: COMPLETE. Priority select replaced with a fieldset of 3 native radios styled as h-11 segmented buttons (sr-only inputs, label-as-button). Selected-only coloring: normal=zinc-700, urgent=amber-500, critical=red-600; unselected stay neutral outline. Same priority state, no validator/enum/DB change. Test-first: tests/unit/purchase-request-form-priority.test.tsx (default normal checked; selecting critical unchecks rest). lint/typecheck/test all green (265 tests). Also shipped same-day, pre-spec: mobile stacking fix for date/priority row (5bdacf7) and appearance-none on the date input to stop iOS width overflow (d28816a). Open question: request list ships pills already; consider same segmented control on any future edit form.

## Spec 22 - order tracking stepper + on_route status (2026-06-11)

Status: COMPLETE. Part A (DB): on_route enum value (after purchased) + shipped_at fact column granted to appsheet_writer; derive trigger maps purchased+shipped_at => on_route, delivery guard widened to purchased|on_route (skip stays legal per ADR 0027); audit: purchased->on_route as action 'update' with transition payload (no new audit_action value); RLS stage gates widened - WITHOUT this the derive transition violates WITH CHECK (caught pre-push). pgTAP file 19 (16 asserts) + file 17 enum pin updated; suite 444 asserts green post-push. Types regenerated. Part B (UI): PurchaseRequestTracker server component (5 stages, rejected red terminal + muted rest, skipped on_route renders done-without-date, ETA under delivery stage while undelivered), mounted on every /requests card; on_route label + sky-700 pill. 271 unit tests green. OPERATOR TODO: expose shipped_at editable in AppSheet column config + re-run Tier-2 smoke ritual (appsheet_writer_p2.sql). Open question: requester-visible courier/tracking-no fields (future spec).

## Spec 23 - delivery-confirmation photos (2026-06-11)

Status: COMPLETE. DB: shipped the locked spec-16 P2 attachments architecture (table + checks + composite FK + token side table + triple-enforced append-only + \_current/\_appsheet security_invoker views + private pr-attachments bucket with path-bound upload policy) PLUS the ADR 0028 purpose discriminator and delivery-confirmation branches (table INSERT policy + storage policy). Fix-forward during pgTAP: the tombstone-target subquery self-referenced the table inside its own policy -> 42P17 recursion; cured with SECURITY DEFINER helper pr_attachment_tombstone_target_ok (20260614100300), ADR 0011 precedent. pgTAP files 20 (52 asserts incl role-sim) + 21 (bucket); suite 503 asserts green. UI: DeliveryPhotoUploader on delivered cards (direct-to-bucket upload + metadata action addDeliveryConfirmationPhoto), creator-only tombstone removal (AttachmentRemoveButton + removePurchaseRequestAttachment), signed-URL thumbnails via mintSignedUrlsForAttachments, ZoomablePhoto reuse. Pure modules attachment-path + validate-attachment test-first. 277 unit tests green. NOTE: spec-16 P2 reference-attachment UI is now app-code-only (DB shipped here); P3 bridge ADR renumbered 0029. OPERATOR TODO: re-run Tier-2 smoke (script updated for on_route [2c] probe this session); spec-16 P2 operator fixture protocol applies when reference UI ships. Open question: pgTAP storage positive-path upload probe is owned by the smoke ritual, not pgTAP (runner has no storage API).

## Spec 16 P2 UI - reference attachments (2026-06-11)

Status: COMPLETE (DB shipped under spec 23). New action addPurchaseRequestAttachment (per-kind validation, server-rebuilt path, purpose=reference). PurchaseRequestAttachmentStager: deferred mode in the create form (staged chips -> flush(prId) after createPurchaseRequest; failures keep chips with retry + amber note beside the saved confirmation; flushedIdRef enables post-flush retry) and immediate mode in the เพิ่มรูปหรือลิงก์ details-expander on own requested cards. /requests cards render รูปอ้างอิง thumbnails + ลิงก์อ้างอิง anchors (noopener noreferrer nofollow, truncated) for every status; creator-only ลบ while requested. One attachments query for ALL visible requests split by purpose/kind; single signed-URL batch. Form gains required projectId prop (priority test updated). 277 unit green; no schema change. NEXT: P3 AppSheet image bridge (ADR 0029) is now unblocked end-to-end. Verified-by-checklist posture per spec 16 §7 for stager/action wiring (pure seams carry the tests).

## super_admin navigation fix (2026-06-11)

Status: COMPLETE. Operator report: 'superadmin has a weird navigation'. Root cause: roleHome() only knew site_admin/project_manager, so super_admin fell into the /coming-soon default — post-login redirect (LINE callback, /login, /), the /profile back link, and the bare /requests back link all bounced a fully-privileged role to the 'tools not ready' page. Fix: super_admin → /pm (consistent with the tab bar giving super the PM set, spec 19). Test-first: tests/unit/role-home.test.ts pins all served + unserved roles. 279 unit tests green.

## Incident: AppSheet EMAXCONNSESSION (2026-06-11)

Operator screenshot: AppSheet app failed to load — 'max clients reached in session mode, pool_size: 48' on projects + users reads. Diagnosis: AppSheet data source pointed at the SESSION pooler (5432, per go-live checklist Step 2 wording); Supavisor session pools are per-DB-user with a 48-client cap, and AppSheet's parallel sync burst exhausted appsheet_writer's pool. pg_stat_activity showed ZERO held appsheet_writer backends at diagnosis time — burst, not a leak; nothing to terminate; no prod change made. Fix: operator repoints AppSheet to the TRANSACTION pooler (6543). Checklist Step 2 now documents the port split (5432 = smoke ritual only). Raising session pool_size is not viable (already near the compute tier's max_connections). Open question: if AppSheet misbehaves on transaction mode (prepared-statement quirks), revisit — fallback is a dedicated session pool budget discussion.

## PM work-package visibility (2026-06-11)

Status: COMPLETE (option 1 of 2). Operator: 'why PM cannot see WP?' Root cause: navigation gap, not RLS — the PM journey went project list -> reports directly; WPs only reached PMs via the รอตรวจ queue. Fix: the reports page nav strip gains a รายการงาน link to /sa/projects/{id} (already PM-authorized; already the WP review screen's spec-12 back-target). Verified-by-checklist (page link; no pure seam). 279 tests green. Open question: option 2 (a real /pm/projects/{id} hub with WP list + reports tab) if the operator wants PM-styled WP browsing later.

## Spec 24 - photo receipt completes delivery (2026-06-11)

Status: COMPLETE. Operator: 'when status is on_route, users on site can attach images, then we know delivery is complete.' ADR 0030 (amends 0028's delivered-only gate): confirmation-photo INSERT + storage branches widened to on_route|delivered; new AFTER INSERT SECURITY DEFINER trigger purchase_request_attachments_complete_delivery sets delivered_at + received_by (users.full_name) on an on_route parent — existing derive trigger advances status, existing audit trigger writes purchase_request_delivery (principal 'authenticator' = app path, recorded in ADR 0030). purchased rows still deny confirmation photos (flow starts at on_route; open question whether skip-path needs app-side completion). pgTAP 20 plan 52->60; suite 511 green. UI: uploader + photo section on on_route cards; footer copy rewritten (photo confirmation sentence; removed the now-false 'cannot edit in app' claim for delivery). 279 unit green.

## Nav coherence fixes (2026-06-11)

Status: COMPLETE. Operator reports: (1) tab highlight disappears inside tab details — root cause: PM/super on /sa/\* cross-surface paths matched no PM tab (spec 19 accepted this; now reversed by operator). Fix: TabItem gains optional match[] prefixes; PM โครงการ claims /sa; longest-prefix-wins still guarantees exactly one lit tab. bottom-tab-bar test updated (named UPDATE: cross-surface pin flipped) + 2 new cases. (2) Tab roots showed กลับ on mobile where the tabs ARE the nav — /profile back link and the bare /requests back strip are now desktop-only (pinned /requests keeps its contextual spec-12 back-bar everywhere). Audit found no other offenders (other back affordances are contextual: กลับไปหน้ารายการงาน, โครงการทั้งหมด). 281 unit green. Noted, not changed: reports-page nav strip duplicates the รอตรวจ tab destination on mobile — harmless, contextual.

## Spec 25 - WP-inline purchase status, own-row badge, on_route upload fix (2026-06-11)

Status: COMPLETE. Three operator items: (1) BUG: photo upload at on_route failed — addDeliveryConfirmationPhoto's status check still demanded 'delivered' (outlived the ADR 0030 policy widening; bytes uploaded, metadata insert refused). Widened to on_route|delivered. Lesson: when a policy gate widens, grep ALL layers (policy, storage policy, action, UI render condition) — the action layer was missed. (2) WP detail screen now renders คำขอซื้อของงานนี้ — its purchase requests with pill + tracker inline + link to /requests?wp= (operator: status must show inside the WP). (3) Site-wide /requests rows carry a ของฉัน badge when requested_by = viewer. Page-level changes verified-by-checklist; 281 unit green.

## Spec 26 - request card slimming (2026-06-11)

Status: COMPLETE. Operator: card takes too much space. Audit: the stepper (spec 22) already encodes stage dates + ETA, so the standalone อนุมัติเมื่อ / คาดว่าจะได้รับของ / สั่งซื้อเมื่อ / ได้รับของเมื่อ lines were pure duplication (up to 4 text lines per decided card). Removed; supplier + receiver (facts the tracker does NOT carry) fold into one compact line; ขอเมื่อ drops to date-only. Kept: rejection block, needed_by, delivery note, attachments. 281 unit green. Separate-DB question answered in chat (assessment: NO — same-DB; schema gaps listed as iteration queue: cancellation status, PR running number, suppliers table, line items, partial deliveries, courier fields).

## Spec 27 - cancellation + PR running number (2026-06-11)

Status: COMPLETE. ADR 0031. DB: cancelled enum value (after rejected, own migration); cancelled_at/by/reason facts + pr_cancel_shape CHECK; pr_number bigint sequence-fed, backfilled chronologically (requested_at order), NOT NULL+UNIQUE+default; cancellation audit trigger (action 'update', transition payload — third no-new-audit-action use). pgTAP file 22 (15 asserts incl. PM cancel lives / SA statement affects 0 rows / audit payload); enum pins updated in files 17 AND 19 (19's pin was missed first run — lesson: grep ALL enum_has_labels pins when adding a value). Suite 526 green. App: ยกเลิกแล้ว label, muted pill, tracker cancelled state (approve stays green, rest muted — administrative close, test-first), cancelPurchaseRequest action (decide-pattern two-layer guard), ยกเลิกคำขอ button on approved cards (decider-only), PR-XXXX mono prefix on /requests + WP-inline cards. 283 unit green. OPERATOR TODO (BLOCKING for AppSheet saves): mark pr_number, cancelled_at, cancelled_by, cancellation_reason READ-ONLY in AppSheet column config, then re-run Tier-2 smoke. Open seam: requester self-cancel RPC; cancellation-reason UI prompt.

## Spec 28 - WP detail redesign: owner/team, attention strip, responsive IA (2026-06-11)

Status: COMPLETE. ADR 0032 (extends ADR 0013 - membership is display metadata, NEVER an access gate; first deliberately-mutable domain table, justification recorded). Part A DB: work_packages.owner_id + work_package_members (PK wp+user, RLS: staff read / PM+super write with added_by pin; real DELETEs); pgTAP file 23 (15 asserts); suite 541 green; types regenerated. Part A UI: fetchAssignableStaff (admin client, names only; users has NO email column - uuid-head fallback), 3 assignment actions (RLS-relay pattern), WpAssignmentPanel (PM/super details-expander: owner select + member add/remove), header chips ผู้รับผิดชอบ + ทีม (4 names + overflow count). Part B: header summary line (รูป X/3 ช่วง + คำขอซื้อ Y ค้าง), attention strip under header (latest needs_revision=amber / rejected=red w/ comment+decider+date - the SA could never see WHY work bounced on this page before), description details-block (column existed, never shown). Part C: md+ two-column grid (photos 1.6fr left; description/purchasing/history right rail; phone keeps single column photos-first), approval history details (all decisions, pills + comments + names). 283 unit green. Telegram icon convention also adopted this session (memory). Open question: งานของฉัน WP-list filter now one query away.

## Spec 29 - create-form embeds in WP detail (2026-06-11)

Status: COMPLETE. Operator: two WP links (สร้างคำขอซื้อ + ดูรายละเอียดคำขอซื้อทั้งหมด) pointed at the SAME URL (/requests?wp=X) and creating a request teleported users out of the โครงการ tab. Site map drawn in chat. Fix: PurchaseRequestForm now mounts inside the WP detail right rail as a สร้างคำขอซื้อ details-expander (component already took workPackage+projectId props — zero form changes); duplicate header link removed; list link renamed ดูในแท็บคำขอซื้อ → plain /requests (explicit tab switch). /requests?wp= pinned mode remains functional but NO in-app link produces it — recorded seam (candidate for removal in a future cleanup spec). 283 unit green.

## Spec 30 (partial) - WP page zone headers + link removal (2026-06-11)

Status: items 1+2 COMPLETE; item 3 (contractor owners) awaiting operator decision. 1) ดูในแท็บคำขอซื้อ link removed (operator). 2) WP detail gets three zone headers (icon + bold + heavy underline rule): รูปถ่ายงาน (Camera) / คำขอซื้อ (ShoppingCart: create expander + list) / ข้อมูลงาน (FileText: description + approval history) — fixes 'everything looks like the same category'. คำขอซื้อของงานนี้ h2 absorbed into the zone header. 283 unit green. PENDING DECISION (item 3): operator says มอบหมายงาน should assign WP OWNERS = outsiders (subcontractor crews) — needs contractors master table; question asked whether spec-28 internal owner/team stays alongside or is replaced.

## Spec 31 - contractor WP owners (2026-06-11)

Status: COMPLETE. ADR 0033 (supersedes ADR 0032's user-owner UI; operator decision 'Replace' — WPs are executed by outsider crews without logins). DB: contractors master (name nonblank CHECK, phone, created_by pin; PM/super insert+update, NO delete policy — referenced contractors stay forever) + work_packages.contractor_id; pgTAP 24 (12 asserts), suite 553 green; types regenerated. App: assignment-actions reworked (createContractor + setWorkPackageContractor), WpAssignmentPanel reworked (contractor select + inline เพิ่มผู้รับเหมาใหม่ create-and-assign), header line ผู้รับเหมา {name · tel-link}; spec-28 user-owner UI removed — owner_id + work_package_members DORMANT (cleanup candidates at v2, ADR 0033); fetchAssignableStaff now unused by pages (kept — future user pickers). 283 unit green.

## Spec 31 amendment + layout fixes (2026-06-11)

Status: COMPLETE. Operator screenshot (desktop): 1) WP page wasted side space — header/attention/grid wrappers gain lg:max-w-6xl (+ lg:gap-8). 2) SA could not add/assign ผู้รับเหมา — contractors INSERT/UPDATE policies widened to staff (sa/pm/super); assignment moved to SECURITY DEFINER RPC set_work_package_contractor (writes contractor_id ONLY — widening the WP UPDATE policy would hand SA every column); p_contractor_id DEFAULT NULL fix-forward so typegen marks it optional (clearing = omit arg). pgTAP 24 rewritten (14 asserts incl. visitor 42501 + SA-direct-update-still-filtered); suite 555 green. 3) Form cramped in the narrow right rail — date/priority row sm:flex-row removed (viewport variants lie about CONTAINER width; the form's primary home is the rail since spec 29). Lesson: prefer container-relative layout for components that move between containers. 283 unit green.

## Unit: architecture revision doc — entrepreneur lens (2026-06-11)

- **Status:** COMPLETE (doc-only, advisory). Operator brief: "revise the architecture of this app; think like an entrepreneur, not just technical."
- **Deliverable:** [`docs/architecture-revision-2026-06.md`](./architecture-revision-2026-06.md) — strategic assessment of the whole system by business criteria (cost/month, ops burden per change, engagement, sellability, moat).

### Key positions taken (all pending operator sign-off — §6 of the doc)

1. **AppSheet = rented ground.** Stop investing: cancel the unwritten ADR 0029 image bridge, build the in-app procurement surface + suppliers table instead (derive triggers are already writer-agnostic per ADR 0025; `procurement` role waits in the enum), demote AppSheet to read-only, then retire. Kills the per-schema-change operator tax, the Tier-2 write smoke, the EMAXCONNSESSION incident class, and the licence line.
2. **LINE notification outbox promoted to next feature slot** — audit triggers already detect every hand-off event; they just don't deliver. Outbox table + drainer + LINE Messaging API channel.
3. **Railway retired when touched** — PDF on-demand (route handler spike first) or Edge Function; end-state two platforms.
4. **Tenancy decided on purpose:** instance-per-customer for now + tenant-clean discipline + spin-up runbook; multi-tenant schema deferred until customer #2 is real.
5. Migration rehearsal stage (preview branch/scratch project) before destructive pushes; photo client-side downscale question raised; crew capability-URL uploads parked as v2 differentiator; dormant owner_id/work_package_members cleanup listed.

### Open questions

- The four §6 operator decisions (AppSheet sunset, notifications next, tenancy posture, photo downscale).
- No code/schema/test change this unit; suites untouched (555 pgTAP / 283 unit as of a42f083).

## Spec 32 - LINE notification outbox (2026-06-11)

Status: COMPLETE (operator activation pending — checklist §8). Operator granted decision authority ("you are allowed to make the calls"); ADRs 0034 (AppSheet sunset, ADR-0029 bridge CANCELLED), 0035 (instance-per-customer tenancy + tenant-clean rule), 0036 (client downscale becomes the stored original — implementation spec later) recorded the four §6 calls, then the architecture-revision §3.2 priority shipped as spec 32 + ADR 0037.

DB (3c46e22 + 5f4b8be): notification_event_type + notification_status enums, notification_outbox (deliberately mutable delivery state; privileges revoked + RLS with zero policies), four SECURITY DEFINER capture triggers (WP→pending_approval, approvals INSERT, PR INSERT, PR status transitions incl. derive-driven) — failure-SWALLOWING by design (RAISE WARNING; notifications must never block a photo/decision/AppSheet write — recorded divergence from audit triggers). Drain schedule: pg_cron + pg_net every minute → invoke_notification_drain() reads notification_drain_url/secret from Vault, silent no-op until configured. In-build adversarial finding: minute-cron overlap could double-send → claim state (pending→sending + claimed_at, status-guarded UPDATE; 10-min reclaim pass) shipped as spec amendment, enum value in its own migration (spec-27 precedent). pgTAP file 25 (26 asserts incl. role-sim capture paths, derive-driven transition, WHEN-guard negative, cron-job pin); suite 581 green post-push; types regenerated.

App: pure modules test-first (payload narrow, compose-notification Thai copy via central label maps + PR-padding, resolve-recipients with actor-exclusion/no-self-notify + dedupe, drain-policy expiry/reclaim/attempt outcomes, line-push wrapper) — 27 new unit tests, suite 310 green. Drain route handler POST /api/notifications/drain: x-drain-secret gate, 503 not_configured until env set (verified LIVE on dev server: 503 + {"error":"not_configured"}), reclaim→expire→claim→enrich (batched: WP codes, PM pool, photo uploaders, line ids)→compose→per-recipient push→outcome writes. env.server.ts gains LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NOTIFICATION_DRAIN_SECRET (both optional ON PURPOSE — deploys boot unconfigured); .env.example documented. Queued-item pulled forward as dependency: admin.ts gains <Database> generic (typed outbox queries) — surfaced exactly one stale cast (addPhoto .in() as-unknown-as removed). browser.ts typing still queued.

OPERATOR TODO (activation, checklist §8): create LINE Messaging API channel (separate from Login channel), long-lived token → Vercel env ×2 + redeploy, Vault secrets ×2, users friend the OA (QR), acceptance probe (After photo → PM LINE push ≤1 min).

Open questions / seams: per-user notification preferences/opt-out; Flex message formatting; drain-on-write fast path; Web Push fallback; notification history UI; LINE OA message-quota plan choice (operator); failed-row resend tooling. Carried queue unchanged (tap targets, length caps, browser client typing, pending-band ordering test, pagination, ของฉัน band label, real logo, LINE-notification unit NOW DONE, skeleton width). NEXT per ADR 0034: in-app procurement surface + suppliers table (AppSheet write parity → demote to read-only).

### Spec 32 adversarial verification (3-lens workflow) — fixes landed pre-commit

- **Blast-radius + discipline lens — MAJOR, fixed:** `.env.example` shipped the two optional vars as empty assignments; dotenv loads `VAR=` as "" and `.optional()` rejects "" → every fresh "copy .env.example" local boot (and a blank Vercel value) would crash env validation at import time. Fixed both ends: `optionalNonEmpty` preprocess (empty→absent) in env.server.ts + lines commented out in .env.example + 3 new env.test.ts cases (the existing per-var missing/empty pattern now covers the new vars).
- **Blast-radius minors, fixed:** photo_logs uploader enrichment included tombstone rows (uploaded_by = REMOVER per ADR 0015) → `.not("storage_path","is",null)`; no maxDuration on a 50×N-push route → `export const maxDuration = 60`; PostgREST 1000-row cap on the uploader query → loud warn when hit (pilot volumes far below).
- **Security minors, fixed:** drain secret now compared via sha256+timingSafeEqual; LINE 5000-char text limit enforced by truncation in pushLineMessage (an oversized user comment was a deterministic 400 → burned all 3 attempts → actor-controlled notification suppression) + unit test; pgTAP file 25 hardened +11 asserts (plan 37): authenticated UPDATE/DELETE denial, anon denial, policies_are ZERO, EXECUTE denial on invoke_notification_drain for anon+authenticated (PostgREST RPC exposure pin), all four capture functions SECURITY DEFINER + pinned search_path, pr_created WHEN-guard negative, and the headline failure-swallowing posture PROVEN (outbox renamed away inside the transaction → WP write still lands, zero rows captured).
- **Discipline:** payload.ts (5th pure module) had no tests → notification-payload.test.ts added (key mapping, type-narrowing drops, malformed input); recorded here as declared addition alongside the admin.ts typing pull-in. pr_cancelled trigger breadth (any→cancelled vs spec's approved→cancelled) recorded in ADR 0037 as deliberate, with the audit-widening caveat for any future self-cancel unit.

Final suite state: 318 unit / 592 pgTAP / 27 e2e, typecheck+lint clean, drain endpoint live-probed 503 not_configured pre-activation.

## ADR 0034 amendment - atrophy model (2026-06-11)

Operator asked for hybrid pros/cons before AppSheet retirement; evidence pass (2-agent inventory) found the hybrid sounder than the architecture-revision urgency credited: AppSheet write surface = 9 fact columns on ONE table (decide/cancel/create/delivery-by-photo already in-app), derive/audit/notification triggers writer-agnostic, grid bulk-entry value unquantifiable yet (operator: "cannot determine"). ADR 0034 amended: parity build proceeds (in-app purchase/shipment form + suppliers still NEXT) but parity does NOT auto-demote — both paths coexist; demotion when audit_log principal split shows in-app carrying >80-90% of fact-writes for several weeks, or on forcing event (customer #2 / next AppSheet outage). Column freeze + 3 open TODOs unchanged. Volume question converted to measurement (audit principal field) instead of a bet.

## Spec 33 - in-app purchase/shipment recording + suppliers master (2026-06-11)

Status: COMPLETE. ADR 0038 (amends ADR 0025 sole-writer + ADR 0026 eta-AppSheet-only). The ADR-0034-amendment parallel path: AppSheet untouched, zero AppSheet config needed; audit principal now measures which surface back office uses (atrophy model).

DB (4844963 + review-fix commit): suppliers master (contractors mirror — nonblank name, created_by pin, staff read incl. procurement, back-office write pm/procurement/super, NO delete) + purchase_requests.supplier_id FK (analytics link; supplier text stays as RPC-written name snapshot for display/AppSheet continuity). record_purchase + record_shipment SECURITY DEFINER RPCs (role gate, stage guards approved+unpurchased / purchased+unshipped, supplier-name snapshot, amount>0, order_ref<=80). Existing derive/audit/spec-32-notify triggers do ALL the rest — zero new triggers; pgTAP 26 proves end-to-end chain (approved→purchased→on_route walk, purchase audit row, shipment transition audit row, 2 pr_progress outbox rows).

App: validate-record-purchase + isBackOfficeRole pure modules test-first (RED confirmed pre-impl); createSupplier/recordPurchase/recordShipment actions (RPC relays, decide-pattern error unions, 42501/P0001 Thai mapping); PurchaseRecordForm (supplier select + inline เพิ่มผู้ขายใหม่ create-and-pick, order_ref/amount/eta) on approved cards; PurchaseRequestShip (confirm) on purchased cards; both gated isBackOffice; footer copy now names both paths. 325 unit green.

### Adversarial verification (3-lens) — fixes landed pre-commit

- Security: table-level INSERT/UPDATE grants let SA set supplier_id at INSERT and PM desync the supplier snapshot via direct UPDATE → migration 20260616000400 column-scopes authenticated to exactly the create/decide/cancel column sets; fact columns are now RPC/AppSheet-only at the privilege layer. pgTAP pins both denial paths + RPC secdef/search_path + anon EXECUTE denials.
- Blast radius: record_purchase wiped AppSheet-pre-set order_ref/amount/eta when params omitted (eta wipe audit-INVISIBLE — purchase payload has no eta) → migration 20260616000300 coalesce semantics + pgTAP preserved-eta probe. Form: supplier duplicate after revalidate (dedupe), silent amount loss on badInput (validity check).
- Discipline (FAIL → fixed): procurement role cannot reach /requests (requireRole excludes; roleHome → /coming-soon) — recorded as deferred seam in spec+ADR, NOT silently widened (needs requireRole+roleHome+tab-set spec together); record_shipment role gate + shipment audit row were untested (added); createSupplier missing phone-length server check (added); this tracker entry itself (was missing at review time).

Suite state: 325 unit / 27 e2e / pgTAP 26 files (34 asserts in file 26) — db:test rerun after the two review-fix migrations push. Open seams: procurement-role onboarding spec, in-app fact corrections (audited RPC), bulk/grid mode (usage-data-driven), supplier merge/dedup, spend analytics, AppSheet supplier_id backfill. OPERATOR: nothing required — feature is live for PM/super on next deploy; AppSheet keeps working unchanged.

### Spec 33 post-push fix-forward

File 17 G.7/G.8 pinned the superseded spec-16 P1 posture (table-level eta UPDATE grant) and failed against the column-scope migration — rewritten as named UPDATE-tests asserting the ADR 0038 reversal (super_admin direct eta UPDATE now 42501; no case-3 diff from a denied write; appsheet eta-audit coverage lives on in file 18 + smoke [4a]). File 26 plan corrected to 35. Final suite: 627 pgTAP / 325 unit / 27 e2e, all green. Lesson re-learned from spec 27: when a posture flips, grep ALL pgTAP files that PIN the old posture, not just enum pins.

## Spec 34 - client photo downscale (2026-06-11)

Status: COMPLETE (operator phone pass = acceptance, spec §3). Implements ADR 0036: the downscaled file IS the original; max 2000px long edge, JPEG 0.8; downscale is an optimization NEVER a gate — every failure path (HEIC on non-Safari, decode/encode errors, toBlob null) uploads the original unchanged; small files pass through with EXIF intact (orientation correct either way: re-encode bakes orientation via createImageBitmap imageOrientation:'from-image', passthrough keeps EXIF).

Built: src/lib/photos/downscale.ts (computeDownscaleTarget PURE + preparePhotoForUpload browser seam) + photoExtToMime in path.ts — RED confirmed pre-impl, 11 unit tests. Integrated in ALL THREE uploaders at the ext-derivation point (ext flips to jpeg on re-encode BEFORE path building): phase-uploader (PendingUpload now stores prepared blob + lastModifiedMs scalar — no raw File in state; retries reuse prepared bytes), attachment stager, delivery uploader. No DB/storage diff.

### Adversarial verification (2-lens) — fixes landed pre-commit

- Transparent PNG/WebP over the cap re-encoded onto a BLACK background (canvas default substrate under toBlob jpeg) → white fill before drawImage.
- REAL race (stager deferred mode): awaiting prepare BEFORE staging the chip meant a create-form submit during a slow phone decode flushed without the in-flight photo — orphaned 'staged' chip, and a SECOND submission would have attached it to the WRONG purchase request. Fix: chips stage synchronously as 'preparing' (new status + กำลังเตรียมรูป… display), prepare jobs tracked in a ref, flush() awaits outstanding prepares THEN reads a fresh items ref (the closure's items is stale after an await — itemsRef pattern).
- createImageBitmap orientation made explicit (imageOrientation:'from-image' — old Firefox/WebViews don't default to it); ext! assertions narrowed; stager header comment de-drifted; rounding test now exercises a genuinely fractional edge (3000×1000 → 667).

Suite: 336 unit / 27 e2e green; pgTAP untouched (627). OPERATOR (acceptance): fresh camera photo on a test-safe WP → renders correctly oriented; Storage object ~hundreds of KB not MB (dashboard read-only check). Open seams: Web Worker offload (with the offline-queue spec), HEIC polyfill, quality/size UI, retroactive processing (never — append-only).

## Spec 35 - offline-tolerant upload queue, WP phase photos (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance: airplane mode -> photo -> banner -> close browser -> signal -> reopen -> photo lands). ADR 0039. A selected phase photo is never lost: persisted to IndexedDB at selection (survives crash/close/navigation, iOS + Android — NO Background Sync dependency), uploads live exactly as before on good signal, global UploadQueueRunner (root layout; banner รอส่งรูป N รูป only when items wait) drains leftovers on mount/online/visibility/event/backoff (5s·2^n cap 5min).

Architecture: replay is IDEMPOTENT end-to-end so live-path/runner/multi-tab overlap is harmless BY DESIGN — bytes 409 ⇒ alreadyExists ⇒ advance; addPhoto gains a 23505 replay path. Pure core (processQueue/QueueStore/classify/backoff) test-first vs in-memory store — 15 unit tests; IDB store + runner are browser seams (house posture). Items NEVER auto-dropped (evidence); attempts only widen backoff.

### Adversarial verification (2-lens, verdict FAIL -> all fixed pre-commit)

- MAJOR (security): the 23505 verify originally checked id-exists only — photo ids are readable role-wide, so a forged replay with a foreign photo id (e.g. a before-photo id + phase='after') would return ok AND flip the WP to pending_approval with zero after photos. Verify now requires the FULL replayed identity (id + work_package_id + phase + canonical storage_path).
- MAJOR (shared device): queue items now carry userId; the runner SKIPS foreign/ownerless items (uploaded_by is append-only — misattribution is uncorrectable). Post-logout blob persistence recorded in ADR 0039 as an accepted tradeoff; discard UI = seam.
- MAJOR (live-path resilience): addPhoto invocation throw (the exact flaky-signal case) stuck the tile and ABORTED the multi-file loop (remaining files never queued — silent loss) -> try/catch in insertOne + per-iteration isolation in handleFiles. Queue I/O (quota/private-mode IDB) wrapped non-fatal — the safety net can't break the live pipeline.
- MAJOR (idempotency gap): live uploadOne wasn't 409-tolerant — a runner/live overlap left a permanently-failing retry tile; now classifies alreadyExists and proceeds.
- Minors: banner staleness (notify after live remove; lock-unavailable branch refreshes count + short retry), pass-failure now reschedules (30s) instead of freezing, dead nowMs dep removed, projectId dropped from the persisted item (fileName kept for the discard seam, recorded), header lifecycle comment updated.

Suites: 349 unit / 27 e2e green; pgTAP untouched (627); no DB schema diff (addPhoto change is app-layer only). Open seams: reference/delivery photo queueing, manual discard UI, SW Background Sync, Web Worker downscale. OPERATOR: phone acceptance pass for specs 34+35 together (one outdoor session covers both).

## Spec 36 - iteration-9 debt batch (2026-06-12)

Status: COMPLETE. Six carried items closed, one resolved-as-stale, zero schema diff. (1) browser.ts <Database> generic — ALL three Supabase clients now typed; surfaced nothing. (2) Server-side length caps in validateCreatePurchaseRequest (item_description 500 / unit 40, test-first; the iteration-8 security minor) — DB CHECKs still queued pending a prod data-length check. (3) comparePendingRequests extracted to src/lib/purchasing/pending-order.ts + 3 pinning tests (/requests sort path now byte-equivalent but tested). (4) Tap targets: retry button min-h-11; remove button rebuilt as 44px transparent hit square around the 28px disc INSIDE tile bounds — reviewer caught that the first attempt (after:-inset-2) was clipped by the tile's overflow-hidden; lesson: hit-area pseudo-element tricks die under overflow-hidden ancestors. (5) Spinner className variant; white track on the red button (~1.8:1 -> fixed). (6) ZoomablePhoto focus-visible:ring-inset (ring was fully clipped). Stale: reports breadcrumb links already min-h-11 since nav-coherence. Suites: 354 unit / 27 e2e green. Still queued: DB CHECK caps, dark toggle (operator), real logo (asset), dialog a11y foundation, pagination.

## Spec 37 - offline queue for all photo kinds + manual discard (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance, spec §2). Closes both ADR 0039 seams: the loss-proof queue now covers reference attachments and delivery-confirmation photos (not just WP phase photos), and the รอส่งรูป banner expands into a per-item list with confirm-guarded ลบ — the ONLY way an item leaves the queue without landing.

Architecture: QueuedPhoto generalized to discriminated QueuedUpload (phase_photo | reference_attachment | delivery_photo); bucket + metadata action follow the kind; the pure core stays kind-agnostic (runner's insertMeta dispatches). Legacy spec-35 items normalize to phase_photo on read (IDB schemaless — no version bump). Both attachment actions gained the identity-complete 23505 replay (id + parent + kind + purpose + canonical path). Stager queues at runItem time (flush covers deferred mode once the parent exists); userId threaded through PurchaseRequestForm at both hosts. Test-first: 5 new core tests (mixed-kind dispatch, normalization, bucket map, discard race).

### Adversarial verification (2-lens, FAIL -> all fixed pre-commit)

- MAJOR: addPurchaseRequestAttachment's status gate ran before the 23505 verify, so a replay whose insert LANDED but whose response was lost could never confirm after the PM decided — the queue item retried forever for a photo that was already live. Fixed: decided-parent path runs the identity-complete existence check first (read-only); never-landed items on decided parents are refusable BY DESIGN — the reference window closes at decision time (recorded in spec + ADR; discard is the designed out).
- Discard raced an in-flight pass: processQueue's put-backs could resurrect (or send) a just-discarded item. Fixed: QueueStore.has() re-checks before every put-back (pinned by unit test); confirm copy now promises only un-sent deletion.
- Shared-device hole in the NEW surface: the discard list let any device holder (incl. logged-out on /login) see and delete other users' un-sent evidence — contradicting the ADR 0039 skip-foreign stance. Fixed: foreign items render read-only without fileName (รูปของผู้ใช้อื่น — รอเจ้าของเข้าสู่ระบบ).
- Deferred-mode queueing was dead code (userId never threaded to the create form) — silent loss on flush-with-bad-signal survived. Fixed: userId through PurchaseRequestForm at /requests + WP page.
- Delivery failure copy said "ลองใหม่" which would make users re-pick under a NEW uuid → duplicate rows when both landed. Copy now says queued-will-auto-send. a11y: role=status moved off the details element onto the count span (live region must not swallow disclosure semantics/buttons); summary marker restored.

Suites: 359 unit / 27 e2e green; pgTAP untouched (627); no schema diff. OPERATOR: the specs 34+35 phone pass extends to 37 (airplane-mode delivery photo -> banner -> reopen -> lands + auto-completes delivery per ADR 0030). Open seams: SW Background Sync, Web-Worker downscale, link-attachment queueing (deliberately out).

## Spec 38 - re-skin: Refined Utility + brand band (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance). Operator brief: "app looks very generated, buttons/blocks look like an old app"; direction picked under delegated authority from /design-preview options = ก (refined utility) + ข's brand band. Diagnosis doc: docs/design-directions-2026-06.md; spec: 38-reskin-refined-utility.md (the locked class map IS the spec).

Shipped: AppHeader becomes the one dark surface — slate-900 brand band with PRC Ops wordmark (amber accent) + kicker + white heading; LogoutButton gains dark variant (light default untouched on profile/coming-soon). Page sweep (3 parallel agents, disjoint sets, 25 files): zinc-50 page wash under white rounded-xl shadow-sm cards, rounded-lg controls with shadow-xs, border-zinc-300→200 on cards/panels, primary buttons gain shadow + active:translate-y-px. Untouched by design: status pills (sun identity), BottomTabBar, login, scrims, manifest/theme. /design-preview + proxy entry deleted (was temporary). Agents' skip-notes reviewed — all judicious (blue/red-semantic buttons, radio labels, chip rows left alone).

Adversarial lens (computed oklch→WCAG ratios): band pairings all pass big (white/slate-900 17.8:1, amber-400 wordmark 10.4:1, dark logout 14.7:1); ONE regression caught and fixed pre-commit — sweep rule 7 dropped form-field borders to zinc-300 (1.48:1 boundary, 1.4.11 + sun lineage) → 15 field borders restored to zinc-400 via field-only markers (min-w-0/appearance-none); secondary buttons keep zinc-300 (label-identified). Locked-behavior check: zero href/copy/aria/structure changes; pins survived untouched (status-colors/tab-bar/manifest). INFO noted for a future spec: white PWA themeColor now seams against the slate band in installed view.

Suites: 359 unit / 27 e2e green; no DB diff. Lesson: tag-scoped regex dies on JSX arrow-function attributes (onChange={(e) => …} contains '>') — use class-combination markers for element-scoped sweeps. OPERATOR: look at the live deploy (any page) — this is the acceptance pass; say "darker/lighter/rounder/flatter" and adjustment rounds are cheap.

## Spec 39 - on-demand report generation + stale-report reaper (2026-06-12)

Status: COMPLETE (operator acceptance: click สร้างรายงาน -> พร้อมดาวน์โหลด in seconds; Railway logs keep saying "No jobs"). ADR 0040 — revision-doc §3.3 executed in the ADR-0034 atrophy shape: fast path ships alongside the worker; Railway retires by finding nothing.

DB (9a85bfb + amendment): reap_stale_reports() + pg_cron report-reaper \*/5 — closes the documented v1 wedge (stuck 'processing' blocked a project's reports forever). Review amendment (20260617000200): reaper ALSO flips stale 'requested' (>15 min = nothing is processing the queue) — without this, pausing the Railway cron would re-open the wedge for rows the fast path failed to claim; WITH it, pausing Railway is safe any time. pgTAP file 27 (13 asserts: security pins, both stale kinds reaped with distinguishing messages, fresh/terminal untouched, cron pin).

App: worker pipeline PORTED (worker/ byte-untouched — Railway Watch Path + it stays the fallback): build-pdf.ts (same locked layout; Sarabun as a base64 server-only module — fs reads don't survive serverless bundling), run-report-job.ts (claim-assumed runner; every error marks failed + full stack to server log, worker parity). generateReport fast path: insert (unchanged) -> admin claim_next_report (same atomic RPC = app+worker can never double-build) -> runReportJob; every failure mode degrades to the sweeper/reaper. pdfkit pinned ^0.17.2 (review: 0.19 layout drift vs the fallback would make fast-path/worker PDFs differ) + serverExternalPackages. maxDuration=60 on the reports page; button catch degrades a platform timeout to a soft message (reaper recovers server-side). Production build green.

Recorded deviations + decisions: after-photos filter REUSES src/lib/photos/current-photos.ts instead of porting the worker's duplicate (equivalent semantics — worker only adds the phase filter, applied at the call site here; covered by current-photos.test.ts); spec checklist amended accordingly. Known accepted shape: claim_next_report is global FIFO, so a PM's click may build an older queued report from another project first — correct (FIFO) and invisible at pilot volume; their own row is claimed by the next click/sweep. Page copy updated (ไม่กี่วินาที). PDF smoke test runs under @vitest-environment node (fontkit Buffer checks fail across the jsdom realm) and pins the embedded Sarabun by name (PDFKit subsets glyphs, so size is no pin). Suites: 362 unit / 27 e2e / pgTAP 640 expected post-push. OPERATOR: try a report; MAY pause the Railway cron whenever — it is now safe; deleting the service + worker/ dir = future cleanup spec.

## Spec 40 - re-skin round 2, operator feedback (2026-06-12)

Status: COMPLETE (acceptance = operator eye on deploy). Feedback: width unused on most pages, blue buttons unprofessional, deliverable/WP hierarchy unreadable. Fixes: (1) desktop width pass — lg:max-w-5xl across hub/list pages (header/nav/content move together), WP detail to xl:max-w-7xl, card lists go lg:grid-cols-2 (width buys DENSITY not stretched cards); AppHeader/HubNav prop unions widened. (2) Primary fills bg-blue-700 → bg-slate-900 brand dark (hover slate-800), blue outlines → slate, /requests chips + hide-completed toggle follow; links/rings/tab-accent/login/pills deliberately stay. Contrast UP (17:1 vs 6.8:1). (3) work-package-list: deliverable group = one elevated card, header = amber-bar + slate-50 band + bold slate-900 name, WP rows divided+contained inside (ring-inset focus, 56px targets); flat mode keeps cards. Reviewer pass clean. 362 unit / 27 e2e. Note for next rounds: operator look-feedback loop is the acceptance mechanism — keep rounds small and shippable.

## Spec 41 - page width unification (2026-06-12) + SESSION CLOSE

Status: COMPLETE. One canonical PAGE_MAX_W (src/lib/ui/page-width.ts, the WP-detail scale) across every content page's header/nav/content; AppHeader/HubNav prop = typeof PAGE_MAX_W — drift is now a TYPE ERROR. Exceptions recorded: login/profile/coming-soon stay max-w-md (single-card forms). Named UPDATEs: hub-nav + app-shell-primitives test pins. 362 unit / 27 e2e.

### Session 2026-06-11 -> 06-12 summary (architecture-revision sprint)

Shipped: revision doc + ADRs 0034-0040 + specs 32-41 (LINE notification infra, in-app purchasing + suppliers, photo downscale, offline queue x2, debt batch, re-skin x3 + width canon, on-demand reports + reaper). Suites end-state: 362 unit / 640 pgTAP / 27 e2e, all green; prod build green. Revision scoreboard: AppSheet atrophy LIVE, notifications BUILT, Railway OPTIONAL (pause-safe), brand identity established. OPERATOR QUEUE at close: re-skin eyeball rounds (feedback loop = design acceptance), LINE activation (checklist §8, ~15 min), 3 AppSheet column TODOs (saves break until done), ONE outdoor phone pass (specs 34+35+37), try an instant report, optional Railway cron pause. NEXT-SESSION CANDIDATES: more look-feedback rounds, procurement-role onboarding (needs a real user), Railway/worker deletion cleanup (after fast-path history), partial deliveries/line items (on demand), queued smalls (DB CHECK caps, dark toggle, real logo asset, dialog a11y, pagination, PWA themeColor seam).

## Spec 42 - PWA standalone LINE re-login, iOS (2026-06-12)

Status: COMPLETE (operator iPhone pass = acceptance). Operator report: installed PWA loses login after logout; LINE re-login bounces through the LINE app to the system browser, session lands in the wrong cookie jar (iOS standalone jar is separate; CSRF state cookie also splits, so the browser-side callback dies oauth_failed). Fix per spec 42: disable_auto_login=true on the authorize URL for iOS standalone launches (verified against LINE Login v2.1 docs — keeps the whole flow in the PWA's in-app overlay via LINE web login), CSS-toggled standalone login anchor (?standalone=1, display-mode arbitrary variants, no 'use client' — ADR 0012 plain-anchor shape preserved), header logout CSS-hidden in standalone (profile-page logout stays, reachable via bottom tab). Android untested — flag is iOS-UA-gated to avoid regressing the shared-jar WebAPK flow.

Test-first: 3 new route tests (tests/unit/line-start-route.test.ts — env.server mocked at module level since serverEnv validates at import), 2 LoginButton tests, 1 AppHeader logout-wrapper pin. Playwright note: role-based locators ignore the display-hidden second anchor (a11y tree), so the existing e2e href pin survives untouched — 8/8 auth e2e green on chromium. Suites: 368 unit / lint / typecheck green; no DB diff.

Recorded limitation + seam: LINE accounts with no registered email/password cannot complete the web login form (mitigation: browser login -> reinstall PWA; site data copies into the container at install). Real fix if it bites = one-time handoff code minting the session in the PWA via the existing generateLink/verifyOtp machinery (spec 42 out-of-scope section). Supabase inactivity timeout must stay "never" (operator check, no code). OPERATOR: iPhone acceptance pass — install PWA, logout, log back in via LINE web login without leaving the app.

## Spec 43 - device-code handoff login for the installed PWA (2026-06-12)

Status: COMPLETE (operator iPhone pass = acceptance). Shipped 398f8da + types reconcile 1fd8df2 (typegen also caught up reap_stale_reports from spec 39); migration 20260618000100 applied via db push (dry-run showed zero drift first); pgTAP 656/656 (640 + file 28's 16). Operator hit spec 42's recorded limitation within minutes (LINE web login = QR or email/password; both unusable). ADR 0041: device-code handoff. PWA login tap -> POST /auth/handoff/start issues {state, device_code} row (login_handoffs, 10-min TTL, outbox zero-access posture) -> LINE auth with auto-login RESTORED (one-tap in LINE app) -> callback validates state against the DB row instead of the cookie (resolveCallbackFlow precedence: valid cookie always wins = browser path byte-equivalent), binds user_email + claims stash, status approved, shows return-to-app notice -> PWA polls /auth/handoff/poll, which atomically claims (approved->consumed) and mints the session onto the poll response via the ADR 0012 generateLink/verifyOtp pair - sb-\* cookies land in the PWA's own jar. Profile write parity (NULL-only + avatar refresh) runs at poll time from the stashed claims. Spec 42 items 1-2 reverted (disable_auto_login + ?standalone=1 anchor dead); logout hiding stands.

New surfaces: migration 20260618000100 + pgTAP file 28 (16 asserts), src/lib/auth/{line-authorize-url,line-token-exchange,handoff-flow}.ts (exchange/verify extracted - both callback paths verify identically), /auth/handoff/{start,poll} routes, StandaloneLoginButton ('use client' justified: fetch + window.open + poll orchestration; useSyncExternalStore for sessionStorage resume - react-hooks/set-state-in-effect rejects the mount-setState pattern, lesson banked), login page handoff=approved notice, proxy PUBLIC_PATHS +2. database.types.ts hand-extended pre-push; reconcile with pnpm db:types post-push. Suites: 395 unit / auth e2e 8/8 / prod build green / pgTAP 656. Security notes recorded in ADR 0041: device_code never in URLs, single-use via atomic claim, claim-before-mint burn tradeoff, uniform expired answers, device-grant phishing class accepted for internal user base (confirm-tap = hardening seam). Seams: poll rate limiting, Android pass.

## Spec 44 - handoff resume hardening, iOS process death (2026-06-12)

Status: COMPLETE (operator iPhone re-test = acceptance). First spec-43 field test failed: row reached approved (browser success page shown) but PWA never claimed - iOS killed the backgrounded PWA during the LINE/Safari excursion and sessionStorage died with it (no resume, no poll, idle button). Client-only fix in StandaloneLoginButton: (1) localStorage + expiry stamp (line_handoff_device_code / line_handoff_expires_at, 600s = server TTL; stale stamp reads as nothing-stored in the useSyncExternalStore snapshot, clearing only in handlers - no side effects in render), (2) popup opened SYNCHRONOUSLY in the tap gesture (window.open after await can fall outside iOS transient user activation), opener nulled, navigated after the start POST; blocked popup -> same-window fallback (safe now that the code persists), start failure closes the orphan popup. Server untouched - approved rows wait the full TTL for a late claimer by design. 8 component tests (popup contract, resume, stale-stamp idle, fallback). Suites: 398 unit / auth e2e 8/8. Lesson banked: iOS standalone PWA storage assumptions - sessionStorage NEVER survives the app-switch kill; any cross-app handshake state must live in localStorage with its own TTL.

## Spec 45 - handoff opens LINE in same window, no popup (2026-06-12)

Status: COMPLETE (operator iPhone re-test = acceptance). Spec-44 field test: home app went ALL WHITE on tap - iOS standalone PWAs have NO tab model; the spec-44 synchronous window.open('', '\_blank') swaps the visible view to a dead about:blank and the later popup navigation never reaches the user. Fix (client-only, third round on ADR 0041): popup path deleted; tap -> start POST -> store code (spec-44 localStorage+expiry) -> SAME-WINDOW navigation to LINE (no transient-activation concern). Return trip = spec 44's resume: PWA resumes (user closes out-of-scope top-bar view) or relaunches cold at start_url; any LoginButton page resumes the poll. Cancel pin caught a REAL bug: cancel from a resumed waiting state mutated only storage (no React state delta) so useSyncExternalStore never re-read - storage mutations now emit to subscribers (proper external store, not the noop-subscribe shortcut). Suites: 397 unit / auth e2e 8/8. Lessons banked: (1) standalone PWA = never window.open, same-window nav + persistent resume state is the pattern; (2) noop-subscribe useSyncExternalStore is a trap whenever mutations can happen without an accompanying state change.

### Specs 43-45 operator acceptance (2026-06-12)

Operator iPhone pass CONFIRMED: installed-PWA LINE login via device-code handoff works end-to-end (tap -> LINE app one-tap -> return -> auto signed in). The spec-42/43/44/45 arc is closed; PWA re-login is no longer a blocker for field rollout. Remaining handoff seams unchanged (poll rate limiting, confirm-tap hardening, Android pass when a device exists).

### Operator decision 2026-06-12: AppSheet config edits DEFERRED

Operator: 'Keep all appsheet edit as pending, we can edit later.' The 3 outstanding AppSheet console TODOs (mark pr_number + cancelled_at/by/reason read-only, shipped_at editable column) stay pending indefinitely. Accepted consequence: AppSheet saves can break on rows touching those columns until done - consistent with ADR 0034 atrophy posture (in-app is the primary write path; AppSheet usage winding down).

## Spec 46 P1 - daily labor capture (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance). Shipped be0cd4c + pgTAP pin update 4b6b6a1; 3 migrations applied (dry-run showed exactly the 3, zero drift); pgTAP 696/696 after the named enum-pin updates in files 03+18 (the spec-33 "grep ALL pins when an enum grows" lesson struck again — worker_change broke both full-label-set pins, caught post-apply, fixed same session). db:types regen byte-identical to the hand-written extension. Head Tech surplus-share pilot needs labor cost per WP; system captured zero labor data (largest model gap; DC logged days double as payroll). Operator stress-test round resolved C1-C7 pre-spec (no variance view existed; supersede kills unique indexes -> advisory-lock RPC; column grants can't split sa/pm because both are authenticated -> rate columns get ZERO authenticated grant, service-role-only reads behind requireRole(pm/super); techs get NO access change - C4 operator call: verbal report, SA/back-office enters).

Shipped P1: migrations 20260619000100-300 (worker_change audit action; workers master w/ own|dc + contractor FK + user link + zero-grant day_rate + create/update/set-rate RPCs pm/super; labor_logs append-only supersede table w/ zero-grant day_rate_snapshot, snapshots frozen at entry, self_logged computed server-side, log_labor_day + correct_labor_log RPCs sa/pm/super under pg_advisory_xact_lock per (wp,worker,date) - duplicate/inactive/complete-WP refusals, tombstone removals, reason-required corrections). pgTAP file 29 (40 asserts incl. money-posture 42501 pins, append-only triple layer, re-log-after-tombstone). App: lib/labor (validate w/ 14-day backdate gate for SA, current-logs anti-join filter, group-workers, bangkok dates, actions w/ per-worker failure aggregation), LaborLogZone on SA+PM WP pages (presence-only props, fraction toggles, correction dialog, self-log badge PM-only), /workers roster page (pm/super, admin-client rate reads, RPC-only writes). database.types hand-extended. Suites: 422 unit (27 new) / lint / typecheck / build / auth e2e 8/8 green; pgTAP pending push.

Open (P2, same spec): wp_labor_costs freeze at complete, PM cost view w/ >1.0 worker-date surfacing, photo-vs-log variance strip (>=2 day symmetric difference default). Open question recorded: /workers has no nav entry yet (reachable by URL; nav-set change = own small spec); offline = simple retry by design (operator-approved).

## Spec 47 - purchase request detail page (2026-06-12)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator brief: "Clicking should open into order details." New route /requests/[requestId] (same requireRole gate as /requests; non-UUID or RLS-invisible id -> Thai 404, the ?wp= convention); detail screen carries everything the fat card held - tracker, facts, rejection comment, supplier/receiver/note, reference attachments + stager (own x requested), delivery confirmations + uploader (on_route/delivered), and the four role-gated action zones byte-same gates (decision, record-purchase w/ suppliers fetched only then, ship, cancel). List card extracted to PurchaseRequestCard (server-presentational, whole-card Link, chevron, hover wash + ring-inset focus per spec-40 row convention) keeping the at-a-glance set: WP line, PR number, item, qty, requester + Thai badge, needed-by, pills, tracker. List page dropped its attachments/suppliers fetches (lighter query set). Header WP line on detail links to the WP screen. Recorded consequence: PM decisions + back-office recording are one tap deeper - accepted, list is scannable now. Test-first: purchase-request-card.test.tsx (4 asserts: link href, PR/status content, own-badge toggle, NO form/button - slimness is the contract) RED then GREEN. Suites: 426 unit / lint / typecheck / prod build (route registered) / auth e2e 8/8. No DB diff.

### Spec 47 amendment - WP-detail rows clickable too (2026-06-12)

Operator clarified the brief came from the WP detail page. Its khamkhosue zone now renders PurchaseRequestCard per row (workPackage prop null - zone IS the WP context); tap opens /requests/[id] from both surfaces. Page select widened to the card prop set; requester ids unioned into the existing approval-history display-name lookup (still one query). Zone gains priority pill + needed-by + own-badge as a side effect of card reuse - recorded, consistent with /requests. PM review page has no request zone (verified) - SA WP route is the only other surface. Covered by the existing card test contract. Suites: 426 unit / lint / typecheck green.

## Spec 48 - requester notes on purchase requests (2026-06-12)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator WP-detail feedback item 2: "Allow user to include some notes." Migration 20260620000100 applied (dry-run showed exactly the 1 file, zero drift): purchase_requests.notes text, WRITE-ONCE posture - grant insert(notes) to authenticated only, NO update grant (the note is part of what the PM decided on; spec-33 column-scope doctrine), appsheet_writer untouched (ADR 0034 freeze), no DB CHECK (item_description posture, spec-36 queued follow-up). pgTAP file 30 (3 privilege asserts) - 699/699. Test-first: 5 validator cases RED then GREEN (blank->null, trim, 1000 cap with Thai message, exact-1000 boundary; the typical-input toEqual pin named-UPDATEd for the new field). Validator + createPurchaseRequest thread notes; form gains textarea after urgency (maxLength 1000, 3 rows, zinc-400 field border); detail page renders it in the facts card (whitespace-pre-wrap); slim cards deliberately omit it. db:types regen reconciled byte-identical to the hand extension (after prettier - regen drops semicolons, the spec-43 lesson now has a known shape). Suites: 430 unit / lint / typecheck / build / pgTAP 699. Out-of-scope recorded: note editing, PM note threads, notes in LINE payloads.

## Spec 49 - photo filmstrip (2026-06-12)

Status: COMPLETE (acceptance = operator phone pass). Operator WP-detail feedback item 3: "images get too long and scrolling down further and further is against intuition." Per-phase photo grids grew the page vertically without bound; zones below the photos vanished at field volumes. Fix: shared PhotoStrip primitive (src/components/features/photo-strip.tsx) - one horizontal snap-scroll row (flex gap-2 overflow-x-auto snap-x pb-1) + exported PHOTO_STRIP_TILE fixed-square tile constant (h-28 w-28 shrink-0 snap-start ...) so both surfaces stay in lockstep (PAGE_MAX_W idea at component scale). Swapped on BOTH WP surfaces: SA phase-uploader (Thumbnail + PendingTile take the constant; upload lifecycle/remove overlay/ConfirmDialog/queue bracket untouched) and PM PhaseGallery. Phase headings announce the hidden tail: label (N). Page height now constant per phase - more photos = sideways swipe. Test-first: photo-strip.test.tsx (scroll classes + tile geometry pins) RED then GREEN. Zero leftover photo-grid classes (grep). Out of scope recorded: lightbox swipe-between-photos seam, grid toggle, virtualization. Suites: 432 unit / lint / typecheck / build green. No DB diff.

## Spec 50 - lightbox swipe between photos (2026-06-12)

Status: COMPLETE (acceptance = operator phone pass). Operator feedback item 4 first half: "users should be able to slide between pictures left and right" - closes the spec-49 recorded seam. ZoomablePhoto gains optional group/groupIndex props (absent = byte-same single-photo behavior, pinned by the 5 existing tests passing unmodified): dialog opens on the TAPPED photo, prev/next scrim buttons (44px, disabled at ends - non-wrapping by design), ArrowLeft/Right keys, horizontal pointer swipe >= 48px (vertical drags ignored; touch-pan-y + draggable=false on the img), position counter n/total top-left, all hidden for singletons. Groups threaded on 3 surfaces, never spanning sections: SA phase strip (loaded photos per phase), PM PhaseGallery (same), /requests/[id] reference images + delivery confirmations as separate groups. Pending/missing-URL tiles are not group members. Test-first: 6 new lightbox tests RED then GREEN (tapped-photo open + counter, end-disable, arrow keys incl. non-wrap, re-open resets to tapped, singleton/no-group chrome absence). Suites: 438 unit / lint / typecheck / build green. No DB diff. Second half of item 4 (drawing + comments) = spec 51, same session.

## Spec 51 - photo markup: drawing + comments (2026-06-12)

Status: COMPLETE (acceptance = operator phone pass - finger drawing is the make-or-break surface). Operator feedback item 4 second half: "Enable drawing and commenting feature on the image." Doctrine honored: markup is OVERLAY DATA - photo bytes never touched (CLAUDE.md immutability; render-at-view like the ADR-0003 watermark posture); photo_markups is append-only with tombstone removal (supersede-pattern skill loaded; ADR 0004/0009/0015), shaped byte-for-byte on the attachments precedent: content row (>=1 of strokes/comment, supersedes nothing) XOR tombstone, composite same-parent FK, one-tombstone partial unique = anti-join index, triple enforcement, security_invoker current view, table-qualified self-referential policy refs. RLS: sa/pm/super read+insert, creator pin, creator-only tombstone. Migration 20260620000200 applied (dry-run exact); pgTAP file 31 (25 asserts: posture, both malformed shapes, P0001 trigger, 42501 privilege layer, role-sim matrix incl. forged-author + foreign-tombstone denials, view drop after tombstone, dup-tombstone 23505) - 724/724. App: validate-markup.ts (>=1 payload, comment 1000 cap, strokes <=50x500 pts normalized [0,1] - 6 tests RED first), actions (list w/ display names + isMine, add, remove via tombstone), lightbox markup UI (photoId + groupPhotoIds aligned with the spec-50 group so markup follows navigation; SVG overlay viewBox 0..1 + non-scaling stroke; compose mode = pointer drawing + undo + comment textarea + standard save lifecycle; nav gated while composing; ConfirmDialog for delete - bubbling stopped, the nested-dialog-closes-parent hazard). WP surfaces thread ids; request attachments deliberately do NOT (not photo_logs - recorded boundary). Component tests: 4 markup + spec-50 file gained the action-module mock preamble (server-only import poison - the established client-test pattern; zero assertion changes). Suites: 448 unit / 724 pgTAP / lint / typecheck / build. Seams recorded: LINE notify on comment, markup in PDF reports, colors/tools.

## Spec 52 - WP status transitions: during -> in_progress + on-hold toggle (2026-06-13)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator request: "in_progress when during images are uploaded; as for on_hold, allow PM and up to toggle on/off." Spec: docs/feature-specs/52-wp-status-transitions.md. The previously-dead enum values now move: (A) first During photo flips not_started -> in_progress — new shouldTransitionToInProgress predicate + second option-(a) guarded admin UPDATE in addPhoto (.eq status not_started SQL layer; deliberately does NOT release on_hold — that release belongs to the PM toggle; offline-queue replay needs nothing, the guard no-ops on re-entry; outbox trigger fires on pending_approval only, so no stray notifications). (B) setHoldStatus PM/super action — NO admin escalation (work_packages UPDATE RLS already admits pm/super; RLS is the backstop), hold only from not_started/in_progress (pending_approval refused: pausing a queued WP is done by deciding, not hiding), release re-derives the landing status from current During photos via deriveReleaseStatus (no snapshot column, no schema change: in_progress now means exactly "current During photos exist"); HoldToggle client component on the PM WP header (outline พักงานชั่วคราว / solid กลับมาดำเนินการ, hidden on pending/complete; SA page stays read-only per the operator's "PM and up"). Recorded decisions: no audit rows (consistent with both existing transitions; updated_at records when), /pm queue ordering untouchable by the toggle (hold impossible on pending). Test-first: 3 transition-matrix tests + new wp-hold.test.ts (6) RED then GREEN. No DB diff, no migration, no pgTAP delta. Suites: 457 unit / lint / typecheck green.

## Spec 53 - refresh button on every content page (2026-06-13)

Status: COMPLETE (acceptance = operator tap on deploy). Operator rider on the pending design request: 'Also include a refresh button' - shipped first because it is independent; the installed PWA has NO reload chrome, so stale server-component data forced kill-and-relaunch in the field. RefreshButton client component (router.refresh in useTransition - keeps client state incl. the offline-queue banner, deliberately not a hard reload; RotateCw icon, 44px target, aria-label="รีเฟรช", animate-spin while pending, dark/light variants on the LogoutButton prop shape). Placement: AppHeader dark variant (every hub page; NOT standalone-hidden - pinned by a new test, the inverse of the spec-42 logout pin) + light variant right-aligned in the back-link row of all four bespoke detail headers (SA project WP list, SA WP detail, PM WP detail, /requests/[id]). Recorded exceptions: /profile, /coming-soon, /login (max-w-md single-card pages, no stale surface). app-shell-primitives suite gained the next/navigation mock (AppHeader now mounts a useRouter consumer). Test-first: refresh-button.test.tsx 3 tests RED then GREEN. No DB diff. Suites: 461 unit / lint / typecheck green. PENDING from the same operator message: 'designs similar to this for all pages' - reference attachment never arrived in-session; operator says he will re-attach. Design sweep = next unit once the screenshot lands.

## Spec 54 - WP detail redesigned to the operator's mockup (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy; tuning rounds expected per the spec-40 loop). Operator sent a mockup screenshot ('designs similar to this for all pages'): this unit rebuilds the REFERENCE page (SA + PM WP detail) and extracts the primitives; remaining pages follow in later rounds. New primitives: derivePhaseProgress (pure: doneCount / currentPhase = LAST phase with photos / 3 segments complete-current-empty, gap phases stay empty - 5 matrix tests), PhaseProgressBar (green/blue/zinc segments + Thai caption), AttentionCard (amber/red left-bar callout, role=alert - REPLACES the bespoke rejected/needs_revision strip so one attention pattern serves the app), CountChip (amber pill + numbered disc, null at 0), formatThaiTime (HH:MM h23 Bangkok pin, raw-string degradation). SA page: back chip header (44px rounded-xl, ArrowLeft) + refresh, code over text-2xl bold name + pill, progress band, attention stack (PM decision card / unassigned-contractor card wrapping the UNTOUCHED WpAssignmentPanel / requested-count chip anchored #wp-requests), assigned-contractor line + panel stay in header. PhaseUploader restyled to timeline rows: check disc (green >=1 photo) + label + N rup, rail-indented body, last-updated line, strip gains dashed Camera 'add' FIRST tile (same hidden input - upload/queue/remove machinery byte-equivalent, header button removed), tiles get capture-time gradient overlays (captured_at_client ?? created_at). PM page: same header shape (HoldToggle + create-request link share a row), progress band, PhaseGallery mirrors the timeline treatment read-only. Recorded deviations (data-honest): no photo captions (no column - own spec), no quota so no 'thai krob laew' line, no per-phase edit link (per-tile removal already exists), chip counts status='requested'. Test-first: 12 tests across phase-progress/attention-card/count-chip RED then GREEN. Suites: 473 unit / lint / typecheck / prod build green. No DB diff. NEXT ROUNDS: same language on hub/list pages + request detail after operator eyeball.

## Spec 55 - mockup design language round 2 (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy). Operator 'proceed' after spec 54: remaining detail surfaces adopt the language. /requests/[requestId]: back chip (spec-54 shape, RefreshButton stays), title to text-2xl bold, rejection block -> AttentionCard red (one attention pattern, third adopter). /sa/projects/[projectId]: back chip + text-2xl bold project name. Recorded NOT-touched: reports-page back link lives in a tab-style nav row (not a detail back); hub pages KEEP the AppHeader brand band - the mockup shows a detail screen, no evidence the operator wants the band gone; ask via feedback loop, do not guess. Pure restyle - no new logic, no tests added (spec-40 precedent; AttentionCard contract already pinned). Suites: 473 unit / lint / typecheck / prod build green. No DB diff. Remaining design seams: hub/list card language (pending operator direction on the band), photo captions column (operator word pending), per-WP progress hints on the list page (needs a photo-count query - candidate only).

## Spec 56 - WP list: status-view filter, search removed (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy). Operator screenshot feedback: hide finished by default, 'should there be more items to pick though?', no search on WP list. Answer shipped: search box + hide-completed checkbox REPLACED by a four-view segmented control (spec-21 shape, radiogroup semantics): ngan khang (default - everything not complete), ro truat (pending_approval only - what waits on the PM), set laew (complete only), thangmod (no filter). Pure helper src/lib/work-packages/list-filter.ts (WP_LIST_VIEWS registry + filterByView + DEFAULT_WP_LIST_VIEW pinned to outstanding) - 6 tests RED then GREEN; component maps the registry. Search force-expand (the spec-11 'searching overrides collapse' rule) deleted with the search box; group headers still derive progress from the UNFILTERED list (spec-12 truth rule); empty copy reworked per view. Local state only, no URL param. Suites: 479 unit / lint / typecheck / prod build green. No DB diff. Recorded: PM-side list reuse imports the same helper if a later round wants the control there.

## Spec 57 - long WP names never truncate + WP-centric principle recorded (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy). Operator screenshot: WP02 name cut to '(+0.0...' on the new detail header; plus the standing principle 'WP is the center of information - Scope/Time/Resource everything is mapped against WP' (now binding for future rounds; recorded in ui-conventions.md section 5 + assistant memory). Class-only fixes: detail-page subjects NEVER truncate (SA WP h1, PM WP h1, request item_description h1 -> break-words full wrap); list rows clamp at two lines, never single-line truncate (WP list rowLink, /pm queue code-name line -> line-clamp-2 break-words); meta/context lines may keep truncate (project line, WP link on request detail - context, not subject). PurchaseRequestCard untouched (slimness is a test-pinned contract). ui-conventions.md section 5 also caught up with the spec-54/55 detail-header reality (text-2xl bold + 44px back chip). Suites: 479 unit / lint / typecheck / prod build green. No DB diff.

## Spec 58 - project settings page for back office (2026-06-13, ADR 0042)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator: 'Add Project setting page for back office people.' First in-app projects write surface. ADR 0042: SECURITY DEFINER RPC update_project_settings(p_project_id, p_name, p_status) instead of widening the ADR-0013 super-only UPDATE policy (column-scoping by definition - name+status ONLY, the spec-31 set_work_package_contractor shape; ADR-0011 checklist: search_path pinned, 42501 role check inside, revoke-then-grant). Gate = pm/super: procurement is in the spec-33 back-office helper but has NO projects SELECT and no UI reach - recorded as the procurement-onboarding unit's job. code IMMUTABLE from the app (ADR-0014 import contract keys on it); name validated in BOTH layers (app validator trim/1-200 + RPC 22023); no audit rows (spec-52 precedent); project CREATION stays console/import. Shipped: migration 20260621000100 applied (dry-run showed exactly the 1 file), pgTAP file 32 (13 asserts: definer/search_path/grant pins, role sims pm-ok/sa-42501/visitor-42501, blank-name 22023, unknown-id false, trim landed, code untouched - plan-count was 12, runner caught the 13th, the recurring count lesson), db:types regen byte-identical to the hand extension after prettier. App: /sa/projects/[id]/settings (requireRole pm/super; spec-54 header, read-only code line, SettingsForm client w/ name input + status select PROJECT_STATUS_LABEL + saved/error surfaces), updateProjectSettings action under USER session (RPC = load-bearing layer), gear chip on the project page back-row rendered for pm/super only. Test-first: 5 validator tests RED then GREEN. Suites: 484 unit / 737 pgTAP / lint / typecheck / prod build green.

## Spec 59 - site-map audit + one project page (2026-06-13)

Status: COMPLETE (acceptance = operator round-trip on deploy). Operator: 'entering the project shows a page, but pressing back from WP list takes user to what appears to be a different page. Recheck all the site map.' Audit verdict: PM project flow crossed THREE 'project' surfaces - /pm/projects rows opened the REPORTS page (not the project), its rai-kan-ngan link led to the WP list, whose back chip was HARDCODED '/sa' = the SA home (a second, different-looking project list). SA flow was already consistent. Fix: (1) /pm/projects rows -> /sa/projects/[id] - the WP list is THE project page for every role (WP-centric doctrine); (2) WP-list back chip role-aware via new projectHubHref(role) in role-home.ts (sa -> /sa, pm/super -> /pm/projects, else roleHome) - 3 tests RED then GREEN; (3) reports reachable via a FileText chip in the project-page header row (pm/super, next to the spec-58 gear) -> /pm/projects/[id]/reports (reports page nav row already round-trips); (4) NEW docs/site-map.md - full audited inventory (route x gate x entry edges x back target), nav changes must update it in the same unit (the ui-conventions contract). Spec-12 locked-back-targets note: this is the operator-driven amendment for the WP-list target; all other back targets verified unchanged. Recorded seams: /sa vs /pm/projects dual hubs (merge = design-round candidate), /workers still has no nav entry, procurement column empty. Suites: 487 unit / lint / typecheck / prod build green. No DB diff.

## Spec 60 - reports page: detail header + standalone-safe download (2026-06-13)

Status: COMPLETE (acceptance = operator phone pass - share sheet on the installed PWA is the make-or-break). Operator items 1-2: 'Remove these urls, add back button. Pdf download is not working.' Item 1: AppHeader + three-link nav row REPLACED by the spec-54 detail header (back chip -> /sa/projects/[id] per spec 59 entry, refresh, code over text-2xl rai-ngan + project-name line); duplicate project card in the body removed; site-map.md row updated same-unit (its contract). Item 2 root cause: window.open('\_blank') AFTER an await - the spec-45 lesson verbatim (installed PWA has no tab model + iOS transient activation spent). Fix: blob flow - getReportDownloadUrl now mints the signed URL with {download: fileName} (attachment disposition) and returns fileName; new buildReportFileName(code, createdAt) pure helper ({code}-report-{YYYYMMDD}.pdf, Bangkok-pinned, dateless degradation - 3 tests RED then GREEN); DownloadButton fetches the bytes then navigator.share({files}) when canShare (iOS share sheet: Save to Files/LINE/AirDrop; AbortError = silent close) else object-URL anchor[download] click (desktop/Android); failures land on the existing Thai strip. Suites: 490 unit / lint / typecheck / prod build green. No DB diff.

## Spec 61 - PM control over report content (2026-06-13)

Status: COMPLETE (acceptance = operator report try-out). Operator item 3: 'PM needs control over what's being reported under สร้างรายงาน button.' Params model (src/lib/reports/params.ts): scope complete|all + photos after|all_phases|none; DEFAULT = {complete, after} = the legacy report; parseReportParams NEVER throws - per-field fallback so '{}' (every pre-61 row, and anything malformed) renders legacy (5 tests RED then GREEN). Migration 20260621000200 applied: reports.params jsonb not null default '{}' (rides existing policies; written once at INSERT); pgTAP file 12 +2 asserts (type + default) - 739/739. Builder: ReportInputWorkPackage.afterPhotos -> photoGroups [{label, photos}] + optional statusLabel in headings (scope=all) + includeEmptyWorkPackages (photos=none -> compact text listing, skip-empty rule disabled - the listing IS the report); PDF smoke tests named-UPDATEd to the new shape + a spec-61 case. Runner: parses job.params, scope drives the WP query filter, photos mode drives which phases download (after keeps the unlabelled legacy group; all_phases prints Thai phase labels). UI: GenerateReportButton grew two RadioChip groups (ngang-tee-ruam / roop-thai, spec-21 segmented lineage, defaults = legacy); action normalises via parseReportParams and stores the canonical literal (interface-vs-Json index-signature lesson: spread to a literal). claim_next_report Returns + reports Row/Insert/Update hand-extended; db:types regen reconciled exactly. RECORDED RISK: the byte-frozen Railway worker IGNORES params - window = fast-path claim failure only (rare; cron sweeps every ~5 min); a worker-built params report = legacy content marked complete. Operator MAY pause the Railway cron (safe since the spec-39 reaper amendment) to close the window - nudged via Telegram. Suites: 496 unit / 739 pgTAP / lint / typecheck / prod build green.

## Spec 62 - sticky headers (2026-06-13)

Status: COMPLETE (acceptance = operator scroll-test on deploy). Operator: 'headers and footers are not fixed in place.' Audit: BottomTabBar already fixed bottom-0 z-40 on every content page (spec 19) - the defect was headers scrolling away. Class-only fix: sticky top-0 z-20 on AppHeader (all hub pages) + the six bespoke detail headers (SA WP list, SA WP detail, PM WP detail, request detail, project settings, reports). z-stack recorded in the spec: headers 20 < upload-queue banner 30 < tab bar 40 < dialog/lightbox scrims 50 - chrome never covers an overlay. Deliberately NOT sticky: the WP-detail progress band + attention stack (pinning the full block would eat a third of a phone viewport; the identity row is what must stay). One new AppHeader sticky pin (RED then GREEN). Suites: 497 unit / lint / typecheck / prod build green. No DB diff.

## Spec 63 - consolidate the reusable chrome (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy - nothing should LOOK different). Operator: 'the reusable elements should be consolidated, so that when there is a change of design, every page remains consistent by default.' The 54-62 rounds had hand-copied class strings: 44px icon chip x8, slate primary button x8(+2 variants), inline error strip x6, sticky detail-header shell x6. Shipped: (1) src/lib/ui/classes.ts - canonical constants (BUTTON_PRIMARY/SECONDARY, ICON_CHIP/\_MUTED, INLINE_ERROR, CARD; constants not components because the same classes land on button/label/Link - the PAGE_MAX_W idea applied to chrome); (2) DetailHeader feature component (back chip + refresh + actions slot + sticky z-20 shell; 3 tests RED then GREEN) adopted by all six detail pages with per-page back targets/aria-labels preserved verbatim (site-map contract); (3) constants adopted across 10 files (7 byte-identical primary sites + hold-toggle secondary + 6 error strips; TWO recorded normalizations: generate-report px-5->px-4 + w-fit composed, purchase-request-decision px-3->px-4 - the only visual deltas, both ~4px padding); (4) ui-conventions.md section 5: hand-rolling these patterns = review reject. Out of scope (recorded): full-app CARD sweep, labor-log-zone's divergent button styles (font-medium, no ring - candidate for a later normalization round), error/not-found rounded-md buttons. Suites: 500 unit / lint / typecheck / prod build green. No DB diff.

## Spec 64 - fixed app shell: chrome that cannot drift (2026-06-13)

Status: COMPLETE (acceptance = operator phone re-test, scroll + overscroll bounce). Operator after spec 62: 'header and footer sticky is not working properly.' Diagnosis: spec-62 sticky/fixed are structurally correct (no overflow/transform ancestors - audited globals.css + root layout) but ride the BODY scroller; iOS standalone rubber-bands body scrolling, so chrome drifts during the bounce - works in DevTools, drifts in the field. Fix = the canonical PWA shell: body LOCKED (h-full overflow-hidden) + new PageShell component (spec-63 consolidation: ONE shell, every route) whose main is the only scroller (h-full overflow-y-auto overscroll-y-contain) with variants app (zinc wash + tab-bar clearance) / card (centered single-card) / bare (profile + coming-soon hub supply their own). All 18 mains across routes swapped; 4 PageShell tests RED then GREEN; ui-conventions section 5 page anatomy rewritten (hand-rolled main = review reject). LIVE-VERIFIED in the preview browser: body overflow hidden at viewport height, main = sole scroller w/ overscroll containment, card variant renders. error.tsx lesson: never prepend imports above 'use client' (directive must stay first statement). Honest caveat recorded: this is the canonical bounce-drift fix; if the operator's symptom was something else (keyboard overlap etc.) the re-test will say so and the shell is the right foundation regardless. Suites: 504 unit / lint / typecheck / prod build green. No DB diff.

## Spec 65 - consolidation pass: behavior-preserving refactor (2026-06-13)

Status: COMPLETE (acceptance = suites; nothing may LOOK or BEHAVE different). Session brief: "full refactoring session." Method: 5-surveyor multi-agent sweep over src/ (76 candidates) + adversarial verification per candidate (66 confirmed, 10 rejected as churn/unsafe); spec 65 took the mechanical byte-identical subset; 6 parallel builder agents on disjoint file sets. Shipped: (1) NEW shared primitives, each TDD-first - src/lib/validate/uuid.ts (UUID\*REGEX/isValidUuid; was 11 private copies + 2 duplicate type-guards; photos/path.ts re-exports), src/lib/dates.ts (bangkokTodayIso + ISO_DATE_REGEX; was 3+3 copies; labor/dates.ts re-exports), src/lib/storage/buckets.ts + storage/signed-urls.ts (generic mintSignedUrls core; the photos/attachments pair were self-described clones, now thin wrappers; closes the recorded missing-test note), src/lib/db/enums.ts (canonical enum aliases; 12 modules converted to re-exports), src/lib/auth/action-gate.ts (getActionUser + NOT_SIGNED_IN; replaced 22 copy-pasted getUser gates with byte-identical returns incl. the reports `reason` shape), src/lib/photos/phases.ts (PHASES + latestCreatedAt; was verbatim x2 in WP pages), PM_ROLES/SITE_STAFF_ROLES in role-home.ts (3 local consts + inline arrays), PHOTO_ACCEPT_MIME derived in photos/path.ts (3 hand-written accept lists). (2) classes.ts +10 constants (SECTION_HEADING, DETAIL_TITLE, FIELD_INPUT/\_SELECT/\_STACKED, BUTTON_PRIMARY_COMPACT/\_SECONDARY_COMPACT/\_SECONDARY_MUTED, INLINE_ALERT_TEXT, BANNER_ERROR) all byte-pinned in ui-classes-spec65.test.ts; CARD adopted at its 9 verbatim sites (was a zero-consumer export); near-variants deliberately untouched and recorded. (3) requests/actions.ts: findLandedAttachment helper (ADR-0039 identity-complete replay check, was verbatim x3; purpose now a param), readPrParent (x2), repeated Thai literals hoisted to file-local consts (strings byte-identical). (4) Type hygiene: ~10 redundant identity casts deleted (one load-bearing cast found in line/callback route restored + recorded - the row annotation is the real fix); latest-decision.ts stale "client is untyped" comment corrected; LaborDisplayRow moved to src/lib/labor/types.ts (fixes lib-imports-from-component inversion); LaborLogZone dead projectId prop removed. (5) Dead code: fetchAssignableStaff/StaffOption deleted, formatPrNumber + DOWNSCALE_QUALITY unexported, ui/card.tsx + ui/button.tsx + button.test.tsx deleted, tsconfig \*\*/\_.mts + eslint out/build ignores + tests/unit/.gitkeep removed. (6) Test infra: server-only neutralized ONCE via vitest resolve.alias stub (14 per-file vi.mock preambles deleted, 4 were already dead); shared tests/helpers/router-refresh.ts (5 files). (7) PR_LIST_COLUMNS in purchasing/columns.ts; detail page composes + ", notes". Stale /requests?wp= comment fixed (PM screen is the remaining producer - NOT orphaned). Audit: 91 files, +501/-794 (net -293), zero migrations, Thai diff audit clean (every removed Thai line = hoisted literal or className swap). DEFERRED QUEUE (each needs own spec): uploader pipeline extraction + uploadPhotoIdempotent (write component tests FIRST), ConfirmActionButton trio merge, ProjectListSection for the sa/pm hub pair, PageSkeleton->PageShell (VISUAL - operator sign-off), parseRequestsSearchParams, requireSessionProfile, serverEnv test-mock dedup, e2e proxy-protection parametrize, Pick<Row> prop types, test gaps (run-report-job, labor error mapping, stager/runner/roster components), purchase-request-form unit select = FIELD_SELECT byte-match found post-pass. Suites: 541 unit (75 files) / lint / typecheck / prod build green. No DB diff.

## Spec 66 + ADR 0043 - documents have a home; on-site purchases recordable (2026-06-13)

Status: COMPLETE (migration APPLIED to prod 2026-06-13, pgTAP 765/765). Site-staff feedback (2 gaps): invoices/receipts that arrive with a delivery had no named upload home; on-site CASH purchases (no request->approve) could not be recorded so the receipt+spend had nowhere to live. Operator calls: record + PM-acknowledge; capture item + receipt; feature-first (design-critique remediation = next unit, spec 67). MODEL (red-teamed by a Plan agent, which flipped one call): new attachment purpose 'invoice' (ใบส่งของ/ใบเสร็จ, image-only v1; PDF = seam); DEDICATED status 'site_purchased' NOT a reuse of 'delivered' (reuse would leak site buys into the appsheet_writer worklist + render the wrong uploader + conflate delivery audit, all via UNCOMPILED predicate edits; a new enum value's blast radius is typecheck-enforced via the exhaustive switch/Record + one pgTAP pin = lower net risk); acknowledged_at/by columns (RPC-only, NOT in any authenticated grant) as the PM-ack gate, badge DERIVED from source+acknowledged_at not a status change; source='site_purchase' discriminator (pr_source_valid CHECK widened - it would have hard-failed 23514 otherwise, red-team catch). Two SECURITY DEFINER RPCs: record_site_purchase (role gate + input re-checks + WP-EXISTENCE probe [SECURITY DEFINER bypasses RLS; v1 access is role-level per ADR 0013 so no per-project scope to probe - role+FK is the full guard], creates the row born terminal, ONE action='insert' audit row reusing the existing enum value [no new audit_action], returns id so the client immediately attaches the receipt) + acknowledge_site_purchase (pm/super, idempotent, scoped). Invoice RLS arm added DROP+CREATE in place (policy name unchanged so policies_are pin stays green; preserves the pr_attachment_tombstone_target_ok 42P17 recursion cure + objects.name qualification; tombstone helper extended so invoice is creator-only removable); storage upload policy widened to purchased/site_purchased. 5 migrations (20260622000100-000500; ALTER TYPE ADD VALUE each its own txn). App: validate-site-purchase (test-first), 3 server actions (recordSitePurchase/addInvoiceAttachment/acknowledgeSitePurchase), database.types.ts hand-extended then reconciled byte-exact with db:types regen. UI (WP-centric): บันทึกการซื้อหน้างาน form on the SA WP-detail purchasing zone (records then immediately reveals the receipt uploader); a NAMED เอกสาร (ใบส่งของ/ใบเสร็จ) section on the request detail visible whenever status in purchased/on_route/delivered/site_purchased (the discoverability fix - a document home appears the moment a delivery lands); site-purchase รอ PM รับทราบ AttentionCard + รับทราบ button (benign action = plain button, not the red ConfirmDialog); requisition stepper hidden for site purchases. CORRECTNESS FIX found while wiring: the request-detail attachment split treated any non-confirmation image as 'reference' - invoices would have leaked into the reference section; split out explicitly. InvoiceUploader is a lean immediate uploader (offline-queue bracket = recorded seam, unlike DeliveryPhotoUploader). LESSONS: (1) adding a status enum value breaks EVERY enum_has_labels pin - files 17 AND 19 both pin the status set (grep-all-pins struck again; updated both, plan counts unchanged since it's a modify not an add). (2) pgTAP under `set local role authenticated` cannot write the runner's \_tap_buf collector table+sequence (42501) - needed `grant insert on _tap_buf` + `grant usage on sequence _tap_buf_ord_seq` to authenticated before the role switch, and `reset role` before finish()/read-back (file 26's pattern). (3) append-only UPDATE under authenticated throws 42501 (privilege layer) NOT P0001 (the block trigger that catches privileged roles) - three-layer append-only, the privilege layer fires first. Seams: PDF invoices, push-notify PM on site purchase, a PM awaiting-acknowledgement queue, amount/supplier capture on site purchases. Suites: 548 unit / 765 pgTAP / lint / typecheck / prod build all green.

## Spec 67 - design-critique remediation + anti-drift pins (2026-06-13)

Status: COMPLETE (8 of 9 survivors; #8 disclosure-chevrons deferred as subjective minor). Closes the design "zero-day" found by the ruthless multi-agent critique earlier this session: SIX of the flaws were the code contradicting the team's OWN written doctrine, surviving because nothing enforced the rules and the one-operator look-loop (one iPhone, one SA account, short seed data, clean indoor screen, normal colour vision, tap-only) structurally cannot surface them. Fixes: (1 CRIT) Thai leading - DETAIL*TITLE += leading-snug (a Thai-only app had ZERO leading override anywhere; wrapped headings crowd stacked tone marks); (2 CRIT) WP-list deliverable group header truncate -> line-clamp-2 break-words (spec-57 hard floor; Thai has no inter-word spaces so truncate shears mid-word); (3 CRIT) all FOUR window.confirm removed (shared ConfirmActionButton for the 3 identical destructive buttons [cancel/ship/attachment-remove, which were copy-paste dups] + inline ConfirmDialog for the queue discard) - the native sheet shows a raw origin string in the installed PWA on the most irreversible actions; (4+7 MAJOR, one fix) extracted RadioChip (native sr-only radio = keyboard + SR from the browser, 44px) from generate-report-button to a shared component; adopted on the WP-list view filter (was min-h-9 36px + fake role=radio on buttons) AND the worker-type picker (fake radiogroup recurrence) AND deduped the report page - kills the sub-44px tap target AND the lying-radiogroup a11y defect together; (5 MAJOR) purchase-request-tracker text-[11px]/[10px] -> text-xs, zinc-500 meaningful dates -> zinc-600 (the §3 floor), leading-tight -> leading-snug; (6 MAJOR) token canon unified: emerald=done, amber=current, blue-700=links-only - killed off-palette green-600 x5 (phase-progress-bar + phase-uploader + pm WP page done-badges) and the reserved-blue progress fill (current phase was bg-blue-700, the tappable-link hue on a non-tappable bar inches from real tel: links); (9 MINOR) dead .dark palette removed from globals.css (never applied, contradicts "no .dark ever"), /workers got a real PM/super link from the labor empty-state (was dead prose - the orphaned-page reachability seam). THE POINT OF THE UNIT: tests/unit/design-doctrine.test.ts reads src/ as text and FAILS on any recurrence (window.confirm( call, off-palette green-*, min-h-9, group-header truncate, missing DETAIL*TITLE leading, blue progress fill) - drift is now a red test, not a thing the operator has to spot. ui-conventions.md §11 records the doctrine deltas. LESSON: the anti-drift pin caught its OWN false-positive - comments saying "window.confirm (§7)" tripped the call-regex /window\.confirm\s*\(/ (the "(§7)" reads as a call); reworded to "confirm sheet §7 forbids". Scoping matters: the blue-fill and truncate pins are file-scoped (bg-blue-700 is legit on the bottom-tab active indicator; truncate is legit on meta lines per §5) while window.confirm/green/min-h-9 are global. #8 deferred: the native <details> triangle is present (Tailwind preflight keeps it); the gripe was consistency vs the blue-700 inline-link disclosures - subjective, low-value. Suites: 554 unit (77 files, +6 anti-drift pins) / lint / typecheck / prod build green. No DB.

## Spec 68 - Labor P2: cost freeze, PM cost view, close-out variance (2026-06-13)

Status: CODE COMPLETE, local gates green; migration GATED on operator confirm before db:push (prod). Implements the P2 block deferred in spec 46 - cost is the Head Tech surplus-share pilot's input (CEO-review 'Now' #1, unblocked since C1-C7 were already operator-resolved). MODEL: wp_labor_costs snapshot (work_package_id PK, own_cost/dc_cost numeric(12,2), computed_at, frozen_by) - DELIBERATELY MUTABLE one-row-per-WP UPSERT (the audit_log carries the change history, so the snapshot need not be append-only; C6: a post-close labor correction never recomputes it silently - a pm/super re-freezes explicitly, audited). ZERO authenticated grant (money) - read only via the admin client behind requireRole(pm/super), like day_rate_snapshot. freeze_wp_labor_cost(p_wp) SECURITY DEFINER: pm/super gate else 42501 (site_admin refused - rate is money, like set_worker_day_rate); WP-existence probe (SECURITY DEFINER bypasses RLS); own/dc = sum(fraction x day_rate_snapshot) over CURRENT (non-superseded, non-tombstone) labor logs; ON CONFLICT upsert; ONE labor_cost_freeze audit row with own/dc + old_own/old_dc in payload. KEY DECISION: invoked via the caller's AUTHENTICATED session, NEVER the admin client - current_user_role() = role from users where id=auth.uid(), and the service-role client has no JWT (auth.uid() NULL) so the gate would 42501 it; the authenticated PM session yields project_manager + a real frozen_by/audit actor. Two call sites: AUTO in recordDecision right after the admin UPDATE flips the WP to complete (non-fatal - logs on error, never fails the approve; C6 makes a missed freeze recoverable), and the explicit refreezeWpLaborCost action behind a re-freeze button shown on drift. New audit_action 'labor_cost_freeze' in its own migration (ADD VALUE can't be referenced same-txn); enum-label pins updated in files 03 AND 18 (grep-all-pins; file 19's audit_action ref is an action='update' filter, NOT a label pin - verified, so only 2 needed this time). 2 migrations (20260623000000 add value, 20260623000100 table+RPC; RPC tightens beyond the P1 labor RPCs - revoke execute from public, grant to authenticated - since it writes money). App: pure helpers TDD-first (bangkokDateOf in dates.ts; aggregateLaborCost/findOverAllocatedDays/currentLaborPairKeys/fractionDays in labor/cost.ts; computeLaborVariance + LABOR_VARIANCE_MIN_DIFF=2 in labor/variance.ts - the SQL freeze sum MUST equal aggregateLaborCost). database.types.ts hand-extended (wp_labor_costs Row/Insert/Update + freeze fn + enum union + Constants array). UI (PM page ONLY - the SA page stays presence-only; money never on a site_admin-reachable screen): admin-client cost read; LaborCostView server component (own/DC subtotals + total baht, per-worker days+cost+self-log, C5 cross-WP >1.0/day flags filtered to this-WP pairs, frozen-vs-live drift note + RefreezeButton client child); AttentionCard amber close-out variance strip (photo-days bucketed bangkokDateOf vs labor work_dates, surfaces at symmetric-diff >=2 OR photos-with-zero-labor). Tests: 26 new unit (labor-cost/labor-variance/dates-bangkok) RED then GREEN; pgTAP file 34 (plan 20: shape/PK/RLS/zero-grant posture, role gate sa+visitor 42501, happy-path own=750/dc=380 + one audit row, WP-not-found P0001, re-freeze upsert single-row + 2 audit rows + prior 750 in payload, superseded/tombstone excluded). Local: 580 unit / lint / typecheck / prod build green; pgTAP 34 + db:types reconcile PENDING the gated db:push. Seams: billing status per WP/deliverable (spec 69, gated on operator per-WP-vs-nguad-ngan decision), payroll export of DC days, a PM awaiting-freeze/drift queue, cost line on the report PDF.

## Spec 69 - DC payroll export: subcontractor days per period (2026-06-13)

Status: COMPLETE (acceptance = operator phone/PC pass - open /pm/payroll, confirm DC-only rollup by contractor for the month, download the CSV in Excel). Picked via the operator's "what next" -> "Payroll export (DC days)" (billing #2 stays BLOCKED on the per-WP-vs-nguad-ngan decision). Answers the cash question spec 68's per-WP freeze does NOT: end of period, how many days did each subcontractor (DC) crew work ACROSS all jobs, and what is owed - independent of any WP close/freeze, so it reads LIVE labor_logs current state, not the wp_labor_costs snapshot. PURE-CODE UNIT: zero schema change, zero DB writes, no db:push, no prod gate - the reports/export path (run-report-job.ts) writes no audit row for a download and the source labor_logs are each already audited at insert, so the export is a derived read; auditing each export (reuse the existing action='export' enum value) is a RECORDED SEAM, not v1. MONEY POSTURE unchanged from spec 68: day_rate_snapshot has zero authenticated grant; read via the admin client behind requireRole(PM_ROLES) on BOTH the page and the export route; Server Component renders text + CSV built server-side, so no rate/amount reaches a client bundle; SA never passes requireRole (roleHome bounces to /sa). DC ONLY - own crew are salaried (monthly), per-day payout would be wrong; own-crew payroll = seam. Pure lib (src/lib/labor/payroll.ts, TDD-first 16 tests RED then GREEN): aggregatePayroll(rows, contractorNames) - current-state filter (ADR 0009 anti-join + ADR 0015 tombstone, replicated not cross-imported to keep the module decoupled) THEN keep worker_type_snapshot='dc' (filter after the supersede pass, NOT a DB eq('dc') - a correction re-snapshots worker_type so a DB-level type filter could drop a superseding row and miscount the stale one); group by contractor_id_snapshot (null -> "ไม่ระบุผู้รับเหมา" sentinel, sorted last) then worker_id; days=Sigma fraction, amount=Sigma fraction x PER-ROW rate snapshot (honours mid-period rate changes, same rule as cost.ts); contractors sorted by name (th), workers by name (th). payrollToCsv - UTF-8 BOM (Excel-Thai), RFC-4180 quoting, header ผู้รับเหมา,ช่าง,จำนวนวัน,ค่าแรง (บาท), one row per worker (raw days / 2dp amount) + a trailing รวม grand-total row. buildPayrollFileName -> payroll-dc-YYYYMMDD-YYYYMMDD.csv (ASCII). monthRangeOf(todayIso) - first/last day of the Bangkok month (deterministic Date.UTC, no now()); parsePayrollRange(from,to,today) - accept YYYY-MM-DD params, fall back to the month on missing/malformed/inverted (a bad URL never crashes the page). Same-date-supersede assumption recorded (corrections/tombstones preserve work_date; a date-moving correction across the period boundary is a seam). Server: src/lib/labor/fetch-payroll.ts (server-only shared read backing BOTH surfaces so CSV and on-screen can't diverge; fetches all worker types in the window + resolves contractor names from contractors, CURRENT name not snapshotted - name-snapshot is a seam). UI: /pm/payroll Server Component (period = zero-client-JS GET form defaulting to the current Bangkok month; per-contractor cards with worker rows + subtotal + grand total; ดาวน์โหลด CSV is a plain <a download> NOT next/link so a prefetch can't fire the export) + /pm/payroll/export route handler (requireRole FIRST, text/csv attachment, no-store) + loading.tsx. PM_HUB_NAV +1 item ค่าจ้าง -> /pm/payroll (4th; PM surfaces are already PM/super-gated so it leaks nothing to SA; hub-nav.test pin + comment updated). BottomTabBar is independently hardcoded (untouched) - a mobile payroll tab is a seam (payroll = back-office, PC-leaning). No pgTAP: no new DB object/RLS/grant - the existing grant tests already prove authenticated cannot read day_rate_snapshot, and the new reads go through the same trusted admin-client + requireRole(PM_ROLES) gate spec 68's cost view uses. Browser preview not feasible (LINE-OAuth wall + money-data seeding) - operator acceptance, same model as spec 68. Suites: 596 unit (+16 payroll, hub-nav pin updated) / lint / typecheck / prod build green. No DB diff. Seams: audit each export (action='export'), own-crew payroll, contractor-name snapshot, date-moving corrections, a "mark period paid" state, a mobile bottom-tab entry.

## Spec 70 - procurement onboarding: the purchasing worklist (2026-06-13)

Status: COMPLETE (migration APPLIED to prod, pgTAP 790/790). Operator "what next" -> procurement chosen as the next unit; first cut = the purchasing worklist (/requests), NOT PR triage / supplier-master / full PM parity. procurement was a v2 role bounced to /coming-soon. MAP-THEN-SPEC found the real shape: isBackOfficeRole ALREADY declares procurement back-office, the record_purchase/record_shipment SECURITY DEFINER RPCs ALREADY gate it in, and purchase_requests + suppliers SELECT ALREADY admit it - but THREE RLS policies never caught up, so procurement on /requests would see blank WP labels (violates the WP-centric principle) and hit broken upload buttons. So the unit = align the privilege layer with the already-declared back-office role.

APP (routing/nav, no prod gate): roleHome(procurement) -> /requests (was /coming-soon); new canonical PURCHASING_ROLES = sa/pm/super + procurement on BOTH /requests + /requests/[id] gates (NOT folded into SITE_STAFF_ROLES - that set gates SA photo/WP screens procurement must not reach); PROCUREMENT_TABS = [คำขอซื้อ, โปรไฟล์] (no โครงการ - projects SELECT deferred per spec 58; no รอตรวจ - not a decider); create-request section HIDDEN for procurement (a processor not a requester - not in the purchase_requests INSERT policy, no WP link to arrive ?wp=-pinned, so the section was inert); WP reference on the detail page renders as plain TEXT for procurement (the /sa WP route is SITE_STAFF_ROLES-gated and would bounce it).

DB (migration 20260624000100, gated on operator go/no-go -> "Apply now"): three-policy widen, each adds 'procurement' to an existing role IN-list, DROP+CREATE in place with NAME unchanged so policies_are pins stay green: (1) work_packages SELECT (read only - INSERT/UPDATE stay pm/super; gives WP identity + project_id for the uploaders); (2) purchase_request_attachments INSERT (the per-purpose arms unchanged - procurement inherits the invoice + delivery_confirmation arms; the reference arm's own-parent+status='requested' predicate keeps it inert for a non-requester); (3) storage pr-attachments INSERT. No new object/column, no data change. appsheet_writer unaffected (current_user_role() NULL for it).

STAYS PM-ONLY (worklist != triage, operator call): approve/reject (PurchaseRequestDecision), cancel, site-purchase recording (lives on the SA WP page, not /requests), site-purchase ack - all already isDecider-gated, so already exclude procurement; this unit widened NONE of them.

TESTS: TDD - role-home.test.ts (roleHome procurement -> /requests; PURCHASING_ROLES membership) + bottom-tab-bar.test.tsx (PROCUREMENT_TABS pin + procurement render: คำขอซื้อ+โปรไฟล์, no โครงการ/รอตรวจ) RED then GREEN. pgTAP +5: file 08 (procurement SELECT allowed / INSERT denied), file 20 (procurement invoice on a purchased parent ALLOWED - also fills a pre-existing invoice-arm RLS test gap - + procurement reference on a foreign requested parent DENIED), file 21 (storage role-gate text-pin includes procurement). db:types regen reconciled byte-EXACT after prettier (RLS-only = zero schema-shape drift). Suites: 599 unit / 790 pgTAP / lint / typecheck / prod build all green.

ACCEPTANCE (operator): sign in as a procurement user -> lands on /requests; sees the site's PRs WITH WP labels; opens an approved request -> records a purchase (supplier dropdown populated); opens a purchased request -> records shipment; uploads an invoice; confirms NO approve/reject/cancel controls; SA + PM screens unchanged. SEAMS: procurement projects SELECT / project hub, desktop HubNav for procurement, a procurement supplier-master screen, a procurement-specific worklist ordering (approved-awaiting-purchase first). NEXT backlog unchanged: spec 71 billing status (still BLOCKED on the per-WP-vs-nguad-ngan operator decision), own-crew payroll, moat-insurance backup/restore drill.

## Spec 71 - notes as backup capture: work-package notes (2026-06-13)

Status: COMPLETE (migration APPLIED to prod, pgTAP 801/801). Operator after spec 70 acceptance gave 2 items: (1) "add notes in places that might need it" -> clarified "Everywhere, we need them as backups in case we forgot a field, user can still put information in notes instead" = a BACKUP-CAPTURE notes field (NOT a discussion thread). (2) statuses as icons vs text -> DECISION: KEEP TEXT-ONLY (operator agreed) - color already carries the fast scan (spec 67 token canon), 13 statuses have no intuitive glyph, Thai-first + a11y want text; NO icon work. DESIGN call for notes: per-entity EDITABLE notes column (matches the existing purchase_requests.notes spec-48 + work_packages.description precedent + the operator's "notes field" mental model), NOT a generic polymorphic notes table (CLAUDE.md forbids mixed-content reference columns; a thread over-architects "a backup field"). Coverage audit found the gaps: editable WP remark, supplier/contractor notes, labor-day note. SCOPED v1 to the highest-value + cleanest slice -> WORK-PACKAGE notes (WP-centric principle #1); suppliers/contractors have NO edit UI today (created/selected only) and labor_logs is append-only, so those slices need their own surfaces/handling = recorded seams.

MODEL: work_packages.notes text null + CHECK (notes is null or length<=2000) [abuse backstop; app caps at 1000 = spec-48 cap; starts closing the queued DB-CHECK gap]. Write path = set_work_package_notes(p_work_package_id, p_notes) SECURITY DEFINER RPC MIRRORING set_work_package_contractor (spec 31): role gate site_admin/pm/super else 42501, search_path pinned, revoke-then-grant execute, nullif(btrim(p_notes),'') so blank clears to null, return found. WHY an RPC: SA is the on-site note author but work_packages UPDATE RLS is pm/super only - the RPC writes the notes column ONLY without handing SA every WP column (the spec-31 lesson). NO audit row (consistent with set_work_package_contractor - WP-column edits aren't individually audited; a note is benign ops text).

APP: validateWorkPackageNotes pure helper (trim, empty->null, 1000 cap) TDD-first; setWorkPackageNotes server action (UUID + cap validate, action gate, RPC relay, revalidatePath); WorkPackageNotes client component (controlled textarea + dirty/save/error/saved state, mirrors wp-assignment-panel) in the WP detail ข้อมูลงาน zone (sa/pm/super reach it). typecheck caught the one trap: typegen types p_notes as a NON-NULL string, so the action passes validated.value ?? "" (the RPC's nullif maps "" -> null) rather than string|null. database.types.ts hand-extended then db:types regen reconciled EXACTLY (only delta vs HEAD = the notes column on Row/Insert/Update + the set_work_package_notes fn, p_notes: string - schema understanding confirmed).

TESTS: 8 unit (validate-notes x4 + work-package-notes component x4) RED then GREEN. pgTAP +11 in file 08: 3 catalog (notes text/nullable + has_function) + 8 behavioral (SA writes via RPC returns true + note landed, visitor 42501, procurement 42501 [reads WPs per spec 70 but never writes], unknown WP -> false, blank -> null x2, length CHECK rejects >2000 = 23514). Suites: 607 unit / 801 pgTAP / lint / typecheck / prod build all green.

ACCEPTANCE (operator): open a WP, type a note in ข้อมูลงาน, save, reload -> persists; confirm SA (not just PM) can write it. SEAMS (the rest of "everywhere", each its own slice): supplier notes + contractor notes (need an edit surface first - none exists), labor-day note (labor_logs.note via a log_labor_day param, append-only carries through corrections), editable purchase-request note (purchase_requests.notes is write-once spec-48; making it editable is a posture change), PM-review-page (/pm/work-packages/[id]) read-only display of the WP note. DB-CHECK caps on the OLDER text columns remain the standing queued item.

## Spec 72 - notes everywhere (program) + Unit 1: shared NotesField + projects.notes (2026-06-13)

Status: COMPLETE (migration APPLIED to prod, pgTAP 808/808). Operator clarified spec-71's "notes" -> "notes on every db, which means every process" = an editable backup field on EVERY user-facing entity. Plan-moded the program (plan file hashed-swimming-duckling.md, operator-approved). ARCHITECTURE (decided, Plan-agent-validated): per-entity `notes text` column + ONE shared presentational NotesField component (generalize WorkPackageNotes), NOT a unified polymorphic table (CLAUDE.md forbids mixed-content reference columns; every existing note is already a column; operator's model = one editable field per record, not a thread; a 9-FK typed table = more surface for no asked-for benefit). Write path reuses each entity's doctrine; a column-only SECURITY DEFINER RPC only where the writer lacks UPDATE. App cap 1000, DB CHECK<=2000 per column. OPERATOR SCOPE: existing-screen entities first (projects=this unit, purchase_requests editable, labor per-day note, workers); suppliers+contractors DEFERRED (no edit screen exists -> needs a build-the-screen effort); deliverables (no surface) + reports (machine artifact) EXCLUDED. Units 2-4 = specs 73-75.

UNIT 1 shipped: (1) SHARED SCAFFOLDING (no DB) - src/lib/notes/validate.ts generic validateNotes(raw, max=1000); validate-notes.ts now re-exports it (validateWorkPackageNotes + its test stay green); src/components/features/notes-field.tsx presentational textarea+dirty/save/error/router.refresh taking an injected onSave callback (no server fn crosses the RSC boundary - each entity keeps a thin client wrapper); work-package-notes.tsx refactored to a ~12-line wrapper over NotesField (its existing test = regression guard). (2) projects.notes: migration 20260624000300 (projects.notes column + CHECK<=2000; DROP 3-arg update_project_settings, CREATE 4-arg with p_notes default null + COALESCE-PRESERVE [case when p_notes is null then notes else nullif(btrim,'') end] so a name/status-only save never wipes the note, explicit '' clears). update_project_settings is the existing pm/super column-scoped escape hatch (ADR 0042) - extended rather than a new RPC. settings/actions.ts + settings-form.tsx gained notes (batched into the one save); page passes initialNotes. LESSON: CREATE OR REPLACE can't add a param -> DROP+CREATE; the 3-arg signature ceasing to exist broke file-32's 2 has_function_privilege pins (grep-all-signature-pins) - updated to 4-arg; the 3-arg CALLS still resolve via the default. db:types regen byte-exact with the hand-extension. TESTS: notes-field.test.tsx (5, RED first) + settings-form.test.tsx (2) + work-package-notes/validate-notes regression. pgTAP +7: file 07 (notes col text/nullable + CHECK>2000) + file 32 (4-arg signature pins; PM sets note + landed + blank clears to null). Suites: 614 unit / 808 pgTAP / lint / typecheck / prod build green.

ACCEPTANCE: open a project's settings (pm/super), type a note, save, reload -> persists alongside name/status. NEXT: Unit 2 spec 73 = purchase_requests.notes editable (set_purchase_request_notes RPC, requester+back-office, replaces the spec-48 read-only block on /requests/[id]). Then Unit 3 labor per-day note, Unit 4 workers note. Deferred: suppliers/contractors (need screens), deliverables, reports excluded, PM-review-page WP-note display.

## Spec 73 - notes everywhere Unit 2: editable purchase-request note (2026-06-13)

Status: COMPLETE (migration 20260624000400 APPLIED to prod, pgTAP 818/818). Second slice of the notes-everywhere program (spec 72 / plan). Spec 48 made purchase_requests.notes write-once by GRANT posture (authenticated INSERT only, no UPDATE - column-scope doctrine ADR 0038). Operator wants it editable. KEY POSTURE: KEEP the no-UPDATE grant (file 30 STILL pins has_column_privilege(authenticated, notes, UPDATE)=false) and add set_purchase_request_notes SECURITY DEFINER RPC as the controlled edit path - the definer (table owner) bypasses both the column grant AND RLS, so the column-scope posture is intact while the RPC is the gated editor. GATE: requester edits their OWN note (requested_by = auth.uid()), back-office (pm/procurement/super) edits ANY; else 42501. nullif(btrim,'') clears. CHECK<=2000 added (app cap 1000). App: setPurchaseRequestNotes action (maps 42501 -> ไม่มีสิทธิ์แก้ไขหมายเหตุ) + PurchaseRequestNotes wrapper over the shared NotesField (spec 72); /requests/[id] read-only note block REPLACED - editable for isMine||isBackOffice, read-only text otherwise. database.types.ts regen byte-exact with hand-extension. TESTS: purchase-request-notes.test.tsx (3, RED first); pgTAP file 30 expanded from 3->13 (kept the 3 grant-posture pins unchanged + 10: catalog has_function, requester edits own + landed, back-office edits any + landed, non-requester SA 42501, visitor 42501, blank clears + null, CHECK>2000; fixtures = sa1-requester/pm-backoffice/sa2-nonrequester/visitor + project + WP + PR). Suites: 617 unit / 818 pgTAP / lint / typecheck / prod build green. ACCEPTANCE: edit+save the note on a request you raised; as PM edit a note on a request you didn't raise; as a non-requester SA the note is read-only. NEXT: Unit 3 (labor_logs.note via log_labor_day + correct_labor_log params), Unit 4 (workers.note). Recorded posture: PR note stays editable after decision (benign backup field).

## Spec 74 - notes everywhere Unit 3: labor-day note (2026-06-13)

Status: COMPLETE (migration 20260624000500 APPLIED to prod, pgTAP 825/825). Third notes slice. An optional note on a daily labor entry; labor_logs is append-only (supersede) so the note is a per-row SNAPSHOT set at log_labor_day and CARRIED FORWARD through corrections (like rate/name snapshots), null on tombstone. Migration: labor_logs.note + CHECK<=2000 + grant select(note) to authenticated (presence data, NOT money - unlike day_rate_snapshot). DROP+CREATE log_labor_day (+p_note, nullif(btrim)) + correct_labor_log (+p_note, carry-forward: case tombstone->null / p_note null->v_orig.note / else nullif; bodies reproduced verbatim from 20260619000300 + the note). App: logLaborDays action +note (shared validateNotes, applied to every entry in the batch); correctLaborLog UNCHANGED (RPC carries note forward automatically - editing a labor note post-entry = recorded seam, the p_note param exists but the UI doesn't expose it). LaborLogZone: one note textarea on the entry form (the day's crew) + shows each row's note; note threaded through LaborDisplayRow + fetch-zone-data select + types. database.types.ts regen byte-exact (note on Row/Insert/Update + p_note on both RPCs). TESTS: labor-log-zone (+2: entry passes note, row renders note), labor-current-logs fixture +note. pgTAP file 29 (+7): note stored at entry, carried through correction, cleared on tombstone, CHECK>2000. LESSON (pgTAP): the CURRENT row is the ANTI-JOIN (not exists newer.superseded_by = ll.id), NEVER `superseded_by is null` (that's the ORIGINAL row a correction supersedes per ADR 0009) - my first draft tombstoned an already-superseded row -> P0001 'log already superseded'; migration was fine, only the test queries were wrong (fixed test, re-ran db:test, no re-push). Suites: 619 unit / 825 pgTAP / lint / typecheck / prod build green. ACCEPTANCE: log a crew day with a note -> shows on each row; correct an entry -> note persists; remove -> note goes. NEXT: Unit 4 (workers.note via create_worker/update_worker params) = last existing-screen slice. Then deferred: suppliers/contractors (need screens), deliverables, reports excluded.

## Spec 75 - notes everywhere Unit 4: worker roster note (2026-06-13)

Status: COMPLETE (migration 20260624000600 APPLIED to prod, pgTAP 831/831). LAST existing-screen notes slice. An editable note on a roster worker; workers is RPC-only-write (rates=money) so the note rides create_worker/update_worker. Migration: workers.note + CHECK<=2000 + grant select(note) (presence, not money). DROP+CREATE create_worker (+p_note, nullif(btrim)) + update_worker (+p_note, CASE-PRESERVE: p_note null->keep / ''->clear / else set; coalesce for name/active/contractor unchanged); bodies verbatim from 20260619000200, audit payloads unchanged. App: createWorker/updateWorker actions +note (shared validateNotes; create passes p_note only when non-empty; update passes raw incl. '' to clear, omits to preserve); WorkerRosterManager add-form + per-row edit note textareas + row display; ManagedWorker +note, /workers page select +note. database.types.ts regen byte-exact (note Row/Insert/Update + p_note on both RPCs). TESTS: worker-roster-manager.test.tsx (new, 3, RED first: row shows note, add passes note, edit passes note - edit uses getAllByLabelText[1] since add-form note is [0]). pgTAP file 29 +6 (placed AFTER the worker_change audit-count=3 pin so the 2 new audit rows don't disturb it): create stores note, update sets note, note-only update preserves name (coalesce), CHECK>2000. Suites: 622 unit / 831 pgTAP / lint / typecheck / prod build green. ACCEPTANCE: /workers (pm/super) add a worker with a note -> shows on row; edit a note -> persists.

### Notes-everywhere program COMPLETE (existing-screen scope)

All 5 existing-screen entities have an editable note: work_packages (71), projects (72), purchase_requests editable (73), labor per-day (74), workers (75). Shared NotesField + generic validateNotes + per-entity column + reuse-the-entity's-write-path (RPC where the writer lacks UPDATE). DEFERRED (need a new management screen first, operator chose to defer): suppliers.note, contractors.note. EXCLUDED: deliverables (no surface), reports (machine artifact). SEAMS: editing a labor note post-entry (correct_labor_log p_note exists, UI doesn't expose), PM-review-page WP-note display. NEXT (operator-chosen direction after notes): the APP-FEEL design round - make prc-ops feel native (motion/transitions, optimistic UI replacing 23 router.refresh round-trips, bottom sheets, toasts+haptics); assessment + 4 prioritized adjustments recorded in memory app-feel-roadmap. Operator deferred it to finish notes; pick it up next session.

## Spec 76 - app-feel slice 1: toast/snackbar system (2026-06-13)

Status: COMPLETE (no DB change; acceptance = operator eyeball on deploy). First slice of the "feel like a native app" round. METHOD (ultracode): a 5-agent audit+design workflow (mapped 37 router.refresh sites + every feedback surface, inventoried reusable primitives, VERIFIED framework facts, mapped shell/overlay mount constraints) -> synthesized the ordered slices + a build-ready slice-1 design; built test-first; then a 3-lens ADVERSARIAL REVIEW workflow (lifecycle/a11y/iOS) caught 2 a11y majors fixed before ship. KEY VERIFIED FACTS that shaped the round: navigator.vibrate = NO-OP on iOS Safari/PWA (all versions) -> haptics DROPPED (worthless for the iPhone-first users; Android-only progressive enh at most); Next 16.2.4 experimental.viewTransition is "not recommended for production" -> motion is CSS-only (@starting-style/keyframes, iOS 17.5+/18+ safe) and LAST, not the experimental route-VT API; design-doctrine.test enforces emerald(not green)+44px floor.

SHIPPED: use-toast.ts (useToast hook + context + NO-OP fallback outside a provider so consumers degrade safely, never throw) + toast-provider.tsx (mounted in root layout WRAPPING {children} so a toast fired just before router.refresh survives the RSC re-render) + globals.css @keyframes toast-in gated by prefers-reduced-motion:no-preference (opt-in; reduced-motion=instant) + classes.ts TOAST_SUCCESS(emerald)/TOAST_ERROR (pinned). z-[45] fixed bottom above the 64px tab bar + safe-area. A11Y (review-driven rework): TWO PERSISTENT sr-only live regions (polite role=status for success, assertive role=alert for errors) that exist on first paint and gain a keyed child per toast -> iOS VoiceOver reliably announces (a region inserted already-containing its text is the silent-failure case the first impl hit); visible pills presentational. Errors PERSIST (no auto-dismiss, WCAG 2.2.1); success auto-dismiss 4s; stack cap 3; timer cleanup on unmount + dropped-item timers cleared; full-contrast 44px dismiss button. ADOPTION: display-name-form + settings-form + notes-field (fans out to all 5 notes surfaces) - success -> toast.success, inline span removed; ERRORS STAY INLINE (field-anchored, deliberate split). TESTS: toast-provider.test (8) + notes-field/display-name assert toast.success fires + no inline span. 634 unit / lint / typecheck / build green. RECORDED SEAMS (review-deferred, not bugs): action-failure-inline-vs-toast (design call, kept inline), toast-inside-useTransition paint latency (device-verify before restructure), toast/queue-banner proximity on small phones, purchase-request-form still uses an inline บันทึกแล้ว span (later adoption wave). NEXT app-feel slices (memory app-feel-roadmap): 2 press/active feedback, 3 optimistic UI (kill the 37 router.refresh flickers), 4 bottom sheets, 5 motion (CSS list-enter; route VT only as a guarded spike).

## Spec 77 - app-feel slice 2: press/active tactile feedback (2026-06-13)

Status: COMPLETE (no DB; acceptance = operator eyeball). Second app-feel slice. Native apps respond on touch; only buttons had a press state (active:translate-y-px) - the cards/rows/tabs/chips/icons people tap had none, and iOS painted its grey tap-flash over them. Verified fact: navigator.vibrate is a no-op on iOS PWA, so :active states are the only "haptic" the primary users get. METHOD: an exhaustive Explore tap-target audit (22 targets lacking press feedback, grouped + traffic-ranked) -> press states on the high-traffic set. SHIPPED: (1) GLOBAL globals.css - -webkit-tap-highlight-color:transparent on html (kills the grey iOS flash) + touch-action:manipulation on a/button/summary/label/[role=button] (drops the ~300ms double-tap-zoom delay -> instant taps); biggest single win, covers every control. (2) active:bg-zinc-100 press tint on PR cards, WP list rows (flat+contained), project rows (sa+pm), PM queue rows; active:bg-slate-200 on the deliverable group toggle. (3) active:translate-y-px on ICON_CHIP/\_MUTED (back/gear/reports) + RefreshButton + RadioChip + the requests filter chips. (4) active:scale-95 on bottom-tab-bar items (transform, no reflow). ICON_CHIP was NOT byte-pinned (audit was wrong) so no pin churn. design-doctrine stays green (zinc/slate press hues, 44px floor kept). 634 unit / lint / typecheck / build green. DEFERRED (low-traffic, covered by the global): text <summary> toggles, desktop HubNav/AppHeader links, report download button, requests back link. NEXT app-feel slices: 3 optimistic UI (kill the 37 router.refresh flickers, careful per-surface), 4 bottom sheets, 5 motion (CSS @starting-style list-enter; route VT guarded spike).

## Spec 78 - app-feel slice 4: bottom-sheet primitive + 1 form (2026-06-13)

Status: COMPLETE (no DB; acceptance = operator eyeball). Bottom-sheet native pattern. SLICE 3 (optimistic UI) DELIBERATELY DEFERRED - it mutates payroll/labor data where an optimistic-then-rolled-back row is confusing; needs careful per-surface treatment (payroll-safe surfaces only), not a tail-of-session rush. SHIPPED: src/components/features/bottom-sheet.tsx (<BottomSheet open title onClose>) - same overlay contract as ConfirmDialog/lightbox (fixed inset-0 scrim z-50, Escape + scrim-click close, content stopPropagation, role=dialog aria-modal, aria-labelledby); bottom-anchored rounded-t-2xl panel + grab handle + sticky header + 44px ปิด, max-h-85vh own overscroll-contained scroller, pb-safe-area. Body already LOCKED (spec 64) so no iOS scroll-leak behind the scrim. globals.css @keyframes sheet-up (translateY 100%->0) gated prefers-reduced-motion. MIGRATION: wp-assignment-panel (มอบหมายงาน) inline <details> -> trigger button opening the sheet w/ contractor picker + add-contractor form; closes on successful assign. Chosen first because it's already a self-contained client component (no server/client boundary change, no form-component change, no test ripple). TESTS: bottom-sheet.test (5: closed=nothing, open=labelled dialog+title+children, Escape closes, scrim-click closes but content click doesn't, ปิด closes). 639 unit / lint / typecheck / build green. SEAMS: full focus-trap not implemented (matches ConfirmDialog; panel takes focus on open), swipe-to-close deferred, more form migrations (create-purchase-request/site-purchase/worker-add) = fast-follows reusing the primitive (the WP-page create-form <details> needs a small client wrapper - it lives in a Server Component - the one boundary to handle next). NEXT app-feel slices: 3 optimistic UI (careful per-surface, payroll-safe only), 5 motion (CSS list-enter safe half; route View Transitions experimental = guarded spike).

## Data-architecture hardening pass (2026-06-13) — audit ranks 1-9 shipped

Status: COMPLETE (all applied to prod under full operator autonomy; verify = operator can't see it, it's infra). Followed a 4-dimension multi-agent audit (normalization/scale/RLS-tenancy/AI-readiness) + synthesis. Full review + deferred roadmap persisted at docs/data-architecture-review-2026-06.md. Nine ranks, 8 migrations (20260625000100-000800) + 1 app change + 7 new pgTAP files (35-41); suite 865 assertions / 0 failures; typecheck/unit/build green. Shipped: (1+2) hot-path indexes - labor_logs superseded_by partial (anti-join) + work_date (the spec-69 payroll date-window was seq-scanning since both composites lead with worker/wp), purchase_requests(requested_by,supplier_id), work_packages(status,updated_at)+(contractor_id), workers(contractor_id,user_id). (5) revoke PUBLIC/anon EXECUTE on the 5 worker/labor mutation RPCs (the 0624 note-param DROP+CREATEs had reset grants to the PUBLIC default; internal current_user_role() gate was the only defense). (4) prune_notification_outbox daily cron (terminal rows >30d - the only disposable log table; audit_log/photo_logs/labor_logs are evidence, partition later). (6) COMMENT ON all 20 tables + load-bearing columns - was 0 table/4 column comments; makes the schema legible to text-to-SQL/AI. (7) purchase_requests.received_by_id FK (the one genuine free-text-where-FK-belongs column; populated on both write paths - record_site_purchase=auth.uid(), delivery trigger=uploader) + reports.params object CHECK + workers.contractor_id delete-block comment. (3) RLS EVAL-ONCE - the headline: every policy called auth.uid()/current_user_role() BARE, evaluated per-row (EXPLAIN-verified: "Filter: current_user_role()=ANY"). Wrapped in scalar subselects -> InitPlan, once per query (EXPLAIN-verified after). Transformed in-DB from pg_get_expr text (no hand-reproduction). 66/67 policies; photo_markups EXCLUDED - its INSERT policy has an inline self-referential subquery (tombstone-target), wrapping calls in either of its policies makes the self-reference re-apply a wrapped policy -> 42P17 recursion (cure = a SECURITY DEFINER tombstone helper like attachments use; deferred). Three migrations (000600 cursor-skip wrapped 34 + broke markups; 000700 snapshot-then-alter wrapped remaining 32 + began markup revert; 000800 finished markup revert). LESSONS: (a) a plpgsql FOR-IN-SELECT cursor over pg_policies skips rows when you ALTER mid-loop (catalog changes under the cursor) - snapshot into a temp table first. (b) Postgres renders a wrapped call as "( SELECT f() AS f )", so literal-string bare-detection false-positives - use regexp_count(total) > regexp_count(select-prefixed). (8) /requests bounded queries - was select\* unbounded + ?mine filtered in JS = silent 1000-row PostgREST truncation + mine-after-cap drop; split pending/decided, ?mine as DB predicate, decided capped explicitly at 500. (9) pgTAP pin of the no-JWT NULL-deny invariant (appsheet_writer/anon/future-AI-role all depend on current_user_role() returning NULL with no sub). DEFERRED (own units, see review doc): AI access contract (CRITICAL - agents must use authenticated RLS context not admin.ts), semantic/analytics views, ai_insights landing table, evidence-log partitioning, pgvector semantic layer; + multi-tenant org_id seam (before customer #2), /requests keyset paging, photo_markups SECURITY DEFINER helper. Caveat: eval-once win EXPLAIN-verified (InitPlan) not load-benchmarked; partition urgency volume-dependent (unmeasured).

## Spec 79 — Project metadata + client information (2026-06-13, COMPLETE units 1-3)

Operator asked "where do users set project/client info, what would help". Read-only design workflow (5 agents) mapped the gap: projects had only code/name/status/notes, NO client concept. Operator scope decisions (AskUserQuestion): client = reusable MASTER table (mirrors contractors/suppliers ADR 0033/0038), not inline; project fields = site_address, contract_reference (immutable like code), start_date, planned_completion_date, project_lead_id (INTERNAL person-in-charge, distinct from client.contact_person), project_type (enum, 6 operator-chosen Thai categories), budget_amount_thb (MONEY). Internal team/supervisors split to SPEC 80 (join table). **Unit 1 SHIPPED (1317a86, migrations 20260626000000/000100/000200 applied to prod under the db:push gate, pgTAP 897/0):** clients master (staff SELECT, PM/super INSERT/UPDATE created_by-pinned, no delete) + projects +8 cols + set_project_client RPC + update_project_settings extended 4-arg→10-arg. MONEY posture: budget SELECT revoked from authenticated — but a COLUMN revoke was inert because authenticated holds a TABLE-level SELECT grant (the spec-46 C3 reality), so 000200 replaced it with explicit per-column grants excluding budget (MAINTENANCE: new projects columns must be added to that grant; money cols intentionally omitted). 000200 also wrapped current_user_role() in the clients policies in (select …) — the eval-once doctrine (file 40) now FAILS on any bare call, caught it on first db:test. validators + PROJECT_TYPE_LABEL + 18 unit tests + compile-time drift guard (tuple vs generated enum) + pgTAP file 42 (32 asserts) + file 32 signature pin updated. **Unit 2 SHIPPED (ca8c4cd):** settings form (/sa/projects/[id]/settings, PM/super) edits all fields + inline "เพิ่มลูกค้าใหม่" (createClient mirrors masters); budget + staff roster read via admin client (budget revoked; users RLS read-self), clients via user session; contract_reference read-only. LESSONS: (a) exactOptionalPropertyTypes forbids passing `undefined` to an optional RPC arg — build the args object and OMIT unset keys (absent = SQL default null = COALESCE-preserve). (b) set_project_client p_client_id has no DEFAULT so typegen types it `string` (non-null); cast to pass null (clears) — or add DEFAULT NULL like spec-31 did. 653 unit / typecheck / lint / build green. **Unit 3 SHIPPED (399df41):** display — project detail header shows client/ผู้รับผิดชอบ (display-name resolved via admin)/type/site lines (each only when set); /pm/projects list shows client name (one batched lookup); PDF report header (fast-path src/lib/reports/build-pdf) prints client name + mailing_address + site_address, suppressed when absent so legacy projects keep the old code/name/Generated header (worker/ stays frozen → renders old header; atrophy-retired). No DB change → no gate. 653 unit/typecheck/lint/build green. **SPEC 79 COMPLETE.** REMAINING: only SPEC 80 (project_members team join table). Seams recorded in spec 79 §Out-of-scope: /pm/clients management page, budget-vs-spend dashboard, clearing date/lead/type/budget back to null (COALESCE preserves), procurement client access. OPERATOR OWES (acceptance): open a project's settings as PM → set site/dates/type/lead/budget, add+assign a client; confirm SA cannot reach settings or see budget.

## Spec 80 — Project team / supervisors (2026-06-13, SHIPPED)

The team list spec 79 split out. **SHIPPED (0902d07, migration 20260626000300 applied to prod under the db:push gate, pgTAP file 43, suite 911/0):** project_members join table (project_id, user_id, added_by, added_at; PK(project_id,user_id); user_id index) — mirrors work_package_members (ADR 0032) but MUTABLE (DELETE granted) and with eval-once-WRAPPED policies from the start (learned from spec-79: a bare current_user_role()/auth.uid() fails file 40; file 40 globally covers project_members so file 43 dropped its own redundant eval-once assert). RLS: staff SELECT, PM/super INSERT (added_by=(select auth.uid()) pinned) + DELETE; procurement excluded. No SECURITY DEFINER RPC — PM/super write directly under the authenticated session (they hold the grant+policy). App: addProjectMember (idempotent — 23505 = already member = ok) / removeProjectMember server actions (PM/super gate); settings-form ทีมงาน section (list + ✕ remove + staff picker to add; add/remove persist immediately via their own actions + update LOCAL state with NO router.refresh so the main form's unsaved edits survive — same pattern as the inline client-add); project detail header shows a ทีมงาน line (member names, admin-resolved alongside the lead in one fetchDisplayNames). project_lead_id (single lead, spec 79) stays distinct. LESSONS: (a) an RLS DELETE with a failing USING deletes 0 rows SILENTLY — no 42501 (only INSERT WITH CHECK throws); test the no-op (rows survive), not throws_ok. (b) the hand-rolled bare-call regex must be case-INSENSITIVE — Postgres renders the wrapped form as "( SELECT current_user_role() …)" uppercase, so a lowercase `!~ 'select …'` false-positives (use file 40's proven global check instead of re-rolling). 653 unit/typecheck/lint/build green. SEAMS (spec 80 §Out-of-scope): per-member role/title, team on the PDF/list (header-only v1), notify-on-add. OPERATOR OWES (acceptance): on a project's settings, add + remove a team member; the header shows ทีมงาน; a duplicate add is a no-op; SA cannot reach settings.

## Spec 81 — Master data management: clients · suppliers · contractors (2026-06-14, SHIPPED)

Operator picked this from a "what next" menu (build the master-data **screens** + unblock the deferred `suppliers.note`/`contractors.note`). **SHIPPED (migration 20260627000000_masters_notes.sql applied to prod under the db:push gate, pgTAP 935/0):** one PM-gated route `/pm/masters` with a RadioChip segmented control (ลูกค้า/ผู้ขาย/ผู้รับเหมา) over the three reference masters — each created inline elsewhere and never editable until now (a name typo on a master that snapshots onto reports/PRs was permanent). Mirrors the `/workers` roster precedent minus the money machinery (no master has a rate/cost column, so reads use the ordinary user-session server client — no admin client).

**Notes-everywhere reaches the masters.** Migration adds `note text` + `CHECK(<=2000)` + `grant insert/update (note)` + a column comment to clients, suppliers, contractors. App cap 1000 (`validateNotes`), DB CHECK 2000 (specs 71–75 doctrine). **No RLS policy dropped/created** — the note rides each table's existing UPDATE/INSERT policy, so the eval-once doctrine (pgTAP file 40) is untouched (this is exactly why a note column needs no RPC: it rides the existing policy). suppliers.note/contractors.note were DEFERRED in specs 74/75 for lack of an edit screen; spec 81 builds the screen, so they land here. Notes-everywhere now covers WP/projects/PR/labor/workers + clients/suppliers/contractors.

**No SECURITY DEFINER RPC.** `/pm/masters` is `requireRole(PM_ROLES)`-gated and PM/super already hold the INSERT/UPDATE policy + column grants on all three (clients pm/super; contractors sa/pm/super⊇pm/super; suppliers pm/procurement/super⊇pm/super), so the six actions (`{create,update}{Client,Supplier,Contractor}Record` in `src/app/pm/masters/actions.ts`) write directly under the authenticated session — the spec-80 project_members precedent. Each action re-checks PM_ROLES before the write: defense-in-depth + a real error, because an RLS UPDATE whose USING fails affects 0 rows SILENTLY (spec-80 lesson) and trusting RLS alone would mask a forbidden edit as success. Update sends only changed keys (omitted=preserve, ""=clear); `norm()` blanks→null. The existing inline quick-adds (createClient in settings, createSupplier in requests, createContractor in WP assignment) are UNTOUCHED — they stay note-less and return the new id for immediate selection in their host flow (recorded simplify-seam: a shared insert core could unify them; they differ in return shape, revalidate target, and note support).

**Components.** `master-manager.tsx` — generic presentational manager driven by a `MasterFieldDef[]` schema (key/label/type text|tel|email|textarea/maxLength); add card + per-row แก้ไข expander; entity actions injected as `onCreate`/`onUpdate` (no server fn imported here — the NotesField pattern; toast on success spec 76; `active:` press tints spec 77). `masters-tabs.tsx` — the segmented-control shell, holds the active tab + binds the field-record→typed-action mappers. `page.tsx` fetches all three lists (user session, `order by name`) → MasterRow[] (snake→camel) → MastersTabs; +loading.tsx. Nav: `PM_HUB_NAV` += ข้อมูลหลัก (5 items, desktop strip; no phone bottom-tab entry — same seam as /workers, /pm/payroll). site-map.md + feature-specs README (79/80/81 added) updated same-unit.

**Method/tests:** TDD RED-first `master-manager.test.tsx` (5: row render, textarea for textarea-type, onCreate with values, onUpdate with only-changed, error render). hub-nav pin bumped to 5 items. pgTAP +24 across files 24/26/42 (each +note column exists/nullable/text, +CHECK>2000 rejected, +has_column_privilege insert/update, +PM note update lands + outcome). database.types.ts hand-extended then `db:types` regen reconciled byte-EXACT (9 insertions / 0 deletions). LESSON: `pick()` union-spread helper keeps the field-record→typed-action mapping exactOptionalPropertyTypes-clean (only present keys forwarded). Suites: 658 unit / 935 pgTAP / lint / typecheck / build green.

**OPERATOR OWES (acceptance):** as PM open `/pm/masters` → three tabs; add a client with a note, edit it, reload → persists; rename a supplier; rename a contractor; add a contractor note; confirm SA cannot reach `/pm/masters`. **SEAMS (recorded):** SA/procurement access to the management page (role-widening units); delete/merge/dedup (ADR 0033/0038 keep masters un-deletable); unify masters-page create with the inline quick-adds; per-record usage view (which projects/WPs/PRs reference a master); client budget/analytics (spec 79 seam).

### Spec 81 amendment — renamed "master data" → Contacts (2026-06-14)

Operator feedback right after ship: "instead of /masters, can we make it contacts? for all the contact settings." Rename only (no DB change — note columns already live): route `/pm/masters` → `/pm/contacts`; nav รายชื่อติดต่อ (was ข้อมูลหลัก), page title รายชื่อผู้ติดต่อ; generic component MasterManager → RecordManager (record-manager.tsx; types RecordFieldDef/RecordRow/RecordActionResult), shell MastersTabs → ContactsTabs (contacts-tabs.tsx), RadioChip group name contact-tab / aria ประเภทผู้ติดต่อ; actions module path moved (CONTACTS_PATH revalidate). Umbrella label รายชื่อติดต่อ chosen (operator) to avoid colliding with the client field ผู้ติดต่อ (contact-person). git mv preserved history on all 6 moved files. Stale `.next/types/validator.ts` referenced the old route path until the build regenerated it (build-cache artifact, not a code error). 658 unit / lint / typecheck / build green post-rename. Spec doc + README + site-map updated; spec file kept its 81-master-data-management.md name with an amendment banner mapping the old names.

## Spec 82 — content-named route namespace (program), Units 1–4 (2026-06-14, UNITS 1–4 COMPLETE; only Unit 5 cleanup remains)

Operator: "site map looks weird, pm lands on sa. The map should be about what is shown on the page, not the role." Program spec [82](feature-specs/82-content-named-routes.md): URL names the surface, role decides landing+chrome, never the prefix. `/requests` already proves the model; project/review/payroll/contacts are holdouts. Five units. **Unit 1 = neutralize the shared project detail subtree `/sa/projects/*` → `/projects/*`** (kills the reported "PM lands on /sa"). Hubs `/sa` + `/pm/projects` stay role-named until Unit 3.

Pre-code audit: notifications (compose-notification.ts) are text-only, NO deep links — redirect concern is external bookmarks only; no routing ADR touches this.

SHIPPED: `git mv src/app/sa/projects → src/app/projects` (history preserved; `/sa` hub page itself stays put). New `src/lib/nav/project-paths.ts` (TDD red→green: project-paths.test.ts, 4 tests) — `projectHref`/`workPackageHref`/`projectSettingsHref` builders replace ~14 scattered inline `/sa/projects/...` template literals across pages, server-action revalidatePaths, the WP-list row, both `/requests` WP cross-links, the reports back chip, the PM-decision cross-revalidate, and both hub rows. The scatter was _why_ the role prefix leaked everywhere → one file to touch on future moves (reports keeps its `/pm/...` home → no builder yet, Unit 2). 3 external importers (`wp-assignment-panel`, `work-package-notes`, `upload-queue-runner`) repointed `@/app/sa/projects/...` → `@/app/projects/...`. `next.config.ts` 307 redirect `/sa/projects/:path*` → `/projects/:path*` (NOT 308 — installed PWA caches permanent redirects stickily; Unit 5 promotes). Bottom-tab highlight: SA hub tab (`/sa`) + PM/super tab (`/pm/projects`) both gain `match: ["/projects"]` (the project surface left `/sa/*`); the old PM `match: ["/sa"]` is dead, replaced. `projectHubHref` UNCHANGED (it returns hubs, which don't move until Unit 3) — back chips still close their round-trip. No gate/RLS/enum change.

Tests updated for the move: design-doctrine WP_LIST const, bottom-tab-bar (2 cross-surface paths → `/projects`, +1 new SA-on-/projects pin), work-package-notes + settings-form mock/import paths, labor-log-zone + detail-header sample strings. LESSON (re-confirmed from spec 81): a route `git mv` leaves stale `.next/dev/types/validator.ts` + `.next/types/validator.ts` pointing at old paths → `tsc` and `next build` both fail on phantom missing modules; `rm -rf .next` + rebuild regenerates them clean. Gates: lint ✓ / typecheck ✓ / build ✓ (route table shows `/projects/[projectId]/*`, `/sa` hub intact) / 663 unit ✓ (was 658; +4 path-builder +1 tab) / e2e 27/27 (2 chromium cold-start flakes on untouched `/sa`+`/pm` proxy-redirect tests, 8/8 on warm re-run). site-map.md + feature-specs README + this tracker updated same-unit.

**Unit 2 SHIPPED (same session, operator "proceed"/override of the one-unit rule):** `git mv src/app/pm/projects/[projectId]/reports → src/app/projects/[projectId]/reports` (history preserved; the `/pm/projects` hub page itself stays — only its reports child moved). New `reportsHref(id)` builder (TDD red→green: +reportsHref test) replaces the project-page รายงาน chip href + the reports `actions.ts` revalidatePath. `next.config.ts` second 307: `/pm/projects/:projectId/reports` → `/projects/:projectId/reports` — SPECIFIC source (`:projectId/reports`, not `:path*`) so the `/pm/projects` hub is untouched. status-colors.ts "used-by" comment + bottom-tab-bar nested-page test path (`/pm/projects/abc/reports` → `/projects/abc/reports`) + go-live-checklist operator URLs (×2) + site-map.md updated. No external importers into the reports dir (verified). Reports stays PM_ROLES-gated; back chip already → projectHref (Unit 1). Gates: lint ✓ / typecheck ✓ / build ✓ (`/projects/[projectId]/reports` present, `/pm/projects` hub intact) / 664 unit ✓ (+1 reportsHref). No reports-specific e2e exists; the move touches no auth/proxy code, so Unit 1's e2e pass holds.

**Unit 3 SHIPPED (same session, operator "ok"/continued override):** folded the two project-list hubs (`/sa` for site_admin, `/pm/projects` for pm/super — same query, same row behaviour) into ONE content-named `/projects` hub. New `src/app/projects/page.tsx` (+loading.tsx) gated SITE_STAFF_ROLES; the role decides ONLY the chrome (kicker หน้างาน vs ผู้จัดการโครงการ; desktop HubNav SA_HUB_NAV vs PM_HUB_NAV) — URL + row behaviour identical. Client-name row now shows for all staff (clients are staff-readable; matches the project detail header). `git rm` old `src/app/sa/page.tsx`+`loading.tsx` and `src/app/pm/projects/page.tsx`+`loading.tsx` (both dirs now empty). `roleHome(site_admin)` `/sa`→`/projects` (pm/super stay `/pm` review queue). **`projectHubHref` RETIRED** (deleted from role-home.ts) — the WP-list back chip is now the constant `/projects`; the spec-59 role-aware helper and the PM-bounced-to-/sa bug it patched are gone. HubNav SA/PM "โครงการ(และรายงาน)" items + both bottom-tab โครงการ tabs → href `/projects` (tab `match` prefixes dropped — href covers `/projects/*`). coming-soon: site_admin redirect → `/projects`; super_admin OperatorHub's two now-duplicate project links (หน้างาน + โครงการและรายงาน) merged to one. settings/actions revalidates `/projects` (was `/sa`+`/pm/projects`). `next.config.ts` two exact 307s: `/sa`→`/projects`, `/pm/projects`→`/projects` (the Unit-1 `/sa/projects/*` + Unit-2 `/pm/projects/*/reports` rules are more specific, stay above). Tests: role-home (site_admin→/projects, projectHubHref block removed), hub-nav + bottom-tab pins, handoff-poll-route (site_admin role-home → /projects — the one initially-missed failure, caught by the suite), e2e `/sa`→`/projects` protected-hub check. Gates: lint ✓ / typecheck ✓ / build ✓ (`/projects` hub present, `/sa`+`/pm/projects` gone) / 661 unit ✓ (664 − 3 retired projectHubHref tests + ... net 661) / e2e [running].

**Unit 4 SHIPPED (same session, operator "next"/continued override):** the last role-named surfaces moved to content-named ones. `git mv`: `pm/page.tsx`+`loading.tsx` → `review/`, `pm/work-packages` → `review/work-packages`, `pm/payroll` → `payroll`, `pm/contacts` → `contacts` (Windows quirk: `git mv` needed the `review/` target dir pre-created with `mkdir`). `roleHome(pm/super)` `/pm` → `/review`. Rewired: review queue page (currentHref + WP link), review WP detail (backHref + 2 LaborZone revalidate props), review actions (4 revalidatePaths → `/review`+`/review/work-packages`), record-decision-form `router.push("/review")`, payroll page (exportHref `/payroll/export` + currentHref), contacts actions (`CONTACTS_PATH`) + the `contacts-tabs` import (`@/app/contacts/actions`), PM_HUB_NAV (3 hrefs), PM_TABS (2 hrefs), coming-soon (pm redirect + operator-hub link), status-colors used-by comments, the project-WP-page producer comment. `next.config.ts` four 307s: `/pm/work-packages/:path*`, `/pm/payroll/:path*`, `/pm/contacts`, then bare `/pm` LAST (exact — must not shadow the specific subtree rules nor the still-live `/pm/requests`). **Left in place (out of scope):** `src/app/pm/requests/route.ts` — the spec-19 `/pm/requests`→`/requests` legacy 308 (now the only thing under `/pm`; Unit 5 candidate to fold into next.config). Tests: role-home + role-sets + require-role (pm roleHome → `/review`, the TDD red set), hub-nav + bottom-tab pins/paths, e2e `/pm`→`/review` protected-hub check. Gates: lint ✓ / typecheck ✓ / build ✓ (`/review`, `/payroll`, `/contacts`, `/review/work-packages/[id]` present; only `/pm/requests` left under `/pm`) / 661 unit ✓ / e2e [running].

REMAINING (spec 82): **only Unit 5** — promote the 307 redirects to permanent (308) once link sources are confirmed migrated, and drop dead/foldable rules (incl. the `/pm/requests` legacy handler → a next.config rule). Everything user-facing is content-named now. OPERATOR OWES (acceptance round-trip): SA → lands `/projects`; PM/super → lands `/review`; review queue → tap WP → `/review/work-packages/[id]`, decision → back to `/review`; ค่าจ้าง → `/payroll` (+ CSV export); ติดต่อ → `/contacts`; all old `/sa*`, `/pm*` bookmarks 307-redirect.

## Spec 83 — Contacts v2 Unit 1: contractor taxonomy + enrich + DC backfill (2026-06-14, SHIPPED)

First unit of the operator-approved **Contacts v2** program (autonomous 15hr run; decisions locked in memory prc-ops-contacts-redesign-plan.md; full-auto prod+main). DB-only, additive. **SHIPPED (migration 20260628000000 applied to prod, pgTAP 948/0):** contractors gains the taxonomy — `contractor_category`('contractor'|'dc'), `contractor_subtype`(NULL; 'regular' | 'dc_company'/'dc_regular'/'dc_temporary') gated by a subtype↔category CHECK, `status` contact_status('active'|'probation'|'blacklisted') — plus enrichment columns contact_person/email/mailing_address/tax_id/specialty (nullable + length CHECK). KEY MODEL: **DC is a classification of contractors, NOT a new table** (a DC party already IS a contractors row via workers.contractor_id; labor_logs.contractor_id_snapshot groups payroll by it). **DC-wins backfill:** any contractor referenced by a dc worker → category='dc' (subtype NULL for triage); dual-role crews surface under DC. worker_type('own','dc') untouched (orthogonal). 3 new enums (contact_status/contractor_category/contractor_subtype). Column-scoped INSERT/UPDATE grants extended; NO RLS policy touched (rides the eval-once-wrapped contractors policies; file 40 untouched). All 4 load-bearing FKs byte-intact. STATUS WRITES ride the existing UPDATE policy + grant for v1 (recorded seam: audited set_contractor_status RPC deferred — needs no audit_action enum value this way). pgTAP file 24 +13 (columns/defaults/CHECK/grants + DC-backfill replay). db:types regen byte-exact (30 ins/0 del). 661 unit / 948 pgTAP / lint / typecheck / build green.

## Spec 84 — Contacts v2 Unit 2: suppliers enrich + service_providers (2026-06-14, SHIPPED)

DB-only, additive. **SHIPPED (migration 20260628000100 applied to prod, pgTAP 968/0):** (1) suppliers gains contact_person/email/mailing_address/tax_id/payment_terms (nullable + length CHECK, column grants extended; rides existing eval-once-wrapped policies; FK purchase_requests.supplier_id intact). (2) NEW service_providers master (ผู้ให้บริการ → รถขนส่ง): id/name(nonblank)/service_subtype enum('transport' default)/status contact_status(default active, reuses spec-83 enum)/phone/contact_person/email/mailing_address/vehicle_type/plate_no/note + created_by/created_at; RLS enabled, SELECT staff (sa/pm/super), INSERT/UPDATE pm/super (created_by pinned), policies authored eval-once-WRAPPED from day one, NO delete, NO appsheet_writer. New enum service_subtype. New pgTAP file 44 (13 asserts: table/RLS/policies/no-delete/CHECK/defaults/PM-insert/SA-denied/staff-read/visitor-none/created_by); file 26 +7 (suppliers cols + grants). db:types byte-exact (73 ins/0 del). Greenfield table = zero inbound FK (bank cols arrive U3). 661 unit / 968 pgTAP / green.

## Spec 85 — Contacts v2 Unit 3: bank info, money-isolated (2026-06-14, SHIPPED)

DB-only, additive. **SHIPPED (migration 20260628000200 applied to prod, pgTAP 982/0):** bank details for paid contacts, PM/back-office only (site_admin CANNOT see) — money-isolation like workers.day_rate. DESIGN: dedicated `contact_bank` table with ZERO authenticated access (RLS on, NO policies/grants) — only the service-role admin client (read, behind requireRole pm/super, wired U5) and the SECURITY DEFINER `set_contact_bank` RPC (write, pm/super) touch it. Chosen over money columns on the 3 masters (those carry a TABLE-level SELECT grant — spec-46 C3 — that would leak a bank column unless every non-bank column were re-granted per table: a 3× footgun). Three TYPED nullable FKs + exactly-one-target CHECK (NOT polymorphic) + partial unique index per FK (one bank row per contact). RPC: 42501 non-pm/super, P0001 unless exactly one target, nullif(btrim), upsert (update-else-insert), updated_by=auth.uid(); execute revoked public/anon, granted authenticated (gate inside). New pgTAP file 45 (14 asserts incl. no-SELECT/no-INSERT priv, CHECK 0+2 targets, SA/visitor 42501, upsert one-row + in-place, partial-unique 23505). db:types byte-exact (76 ins/0 del). 661 unit / 982 pgTAP / green. Bank read/write UI = Unit 5.

## Spec 86 — Contacts v2 Unit 4: select primitive + write-action layer (2026-06-14, SHIPPED)

Code-only (no DB). **SHIPPED:** (1) RecordFieldDef gains `type:"select"` + optional `options[]`; maxLength optional; FieldInputs renders a native <select> (FIELD_STACKED appearance-none); blankValues defaults a select to its first option (valid enum, never ""). Existing text/tel/email/textarea branches byte-unchanged. (2) contacts/actions.ts write layer extended (still PM-gated direct writes, no new RPC): contractors create/update +contractorCategory/contractorSubtype/status (checkEnum over Constants.public.Enums; invalid→generic; subtype ""→null on update) +contact_person/email/mailing_address/tax_id/specialty; suppliers +contact_person/email/mailing_address/tax_id/payment_terms; NEW service_providers create/update (serviceSubtype/status enum-checked + vehicle_type/plate_no + contact fields); clients unchanged. Enum writes spread-omit undefined (exactOptionalPropertyTypes). record-manager.test +1 (select renders + reports value). 662 unit / lint / typecheck / build green. Consumed by U5 (detail page) + U6 (list UI). Bank stays the contact_bank RPC (U3).

## Spec 87 — Contacts v2 Unit 6: list-first UI (5 tabs) (2026-06-14, SHIPPED)

Code-only. The operator's headline ask. **SHIPPED:** RecordManager +2 additive props — `addInSheet` (an Add button opens the add form in a BottomSheet, spec 78; AddCard gains `bare`+`onDone`) and `rowBadge` (status chip). ContactsTabs now 5 tabs: ลูกค้า/ผู้ขาย/ผู้รับเหมา/DC/ผู้ให้บริการ — ผู้รับเหมา & DC are the ONE contractors table split by contractor_category in page.tsx. Per-type schemas use the spec-86 select primitive: contractors get a STATUS select (ปกติ/ทดลองงาน/บัญชีดำ = active/probation/blacklisted — maps the operator's ประจำ/ทดลองงาน/บัญชีดำ; create injects category='contractor'), DC get ประเภท DC subtype select (บริษัท/ประจำ/ชั่วคราว) + status (create injects category='dc'), service providers get status + vehicle/plate, suppliers get tax_id/payment_terms, clients unchanged. contractor/DC/service rows show a status badge (amber probation / red blacklist) + an in-memory status sub-filter (ทั้งหมด/ปกติ/ทดลองงาน/บัญชีดำ). Inline per-row edit retained (detail page next unit). page.tsx fetches all fields, splits contractors by category, adds service_providers. record-manager.test +2 (addInSheet opens sheet, rowBadge chip). 664 unit / lint / typecheck / build green. No DB. Acceptance = operator phone (PM-gated; preview can't auth).

## Spec 88 — Contacts v2 Unit 5: contact detail page + bank block (2026-06-14, SHIPPED)

Code-only (contact_bank + RPC shipped U3). **SHIPPED:** new route /contacts/[type]/[id] (PM/super; type ∈ clients|suppliers|contractors|service-providers, DC uses the contractors route). Server fetches the record (user session, notFound if missing) + bank (admin read, behind the requireRole gate). Renders DetailHeader (back→/contacts) + a read-only field list (Thai labels; status/subtype→Thai) + ContactBankBlock. Field editing stays inline on the list (spec 87); detail = display + bank (+ docs/crew in U7/U8). BANK: src/lib/contacts/bank.ts getContactBank(admin, kind, id) [zero-auth contact_bank read, admin-only]; setContactBank action (PM-gated, calls set_contact_bank RPC on the USER session for auth.uid()/role); ContactBankBlock client (bank name/account no/account name, "เฉพาะผู้จัดการเห็นข้อมูลนี้", save→toast+refresh). clients have no bank. RecordManager +rowHref (row name → detail link); contacts-tabs wires per-type hrefs (DC→contractors route). contact-bank-block.test (RED first, 2). 666 unit / lint / typecheck / build green. Acceptance = operator phone (PM-gated).

## Spec 89 — Contacts v2 Unit 9: blacklist hidden from assignment pickers (2026-06-14, SHIPPED)

Code-only. The operator's core ask. Blacklist = status (never delete, spec 83), so filter at PICKERS, never at history/payroll. **SHIPPED:** (1) WP owner picker — the WP detail page fetches contractors incl. status and passes WpAssignmentPanel a list filtered to drop status='blacklisted' EXCEPT the WP's current owner (an already-assigned now-blacklisted contractor still lists — never blank an existing assignment); assignedContractor header lookup uses the full list; panel unchanged. (2) DC-parent picker — /workers fetches status+contractor_category; WorkerRosterManager filters the new-DC-worker dropdown to category='dc' && status!='blacklisted', while the FULL list still resolves names for existing rows (a worker with a blacklisted/non-dc parent still shows its name). Payroll/history UNFILTERED. worker-roster-manager.test +1 (DC picker shows only non-blacklisted DC crews). 667 unit / lint / typecheck / build green. No DB. Acceptance = operator phone.

## Spec 90 — Contacts v2 Unit 8: crew on a contractor's detail page (2026-06-14, SHIPPED)

Code-only. The operator's "teammates under that subcon". **SHIPPED:** ContactCrewSection (client) on /contacts/contractors/[id] — lists the DC workers parented by the contractor (names only) + an add form (name + day rate). Add reuses createWorker({name, workerType:'dc', dayRate, contractorId}) — the spec-46 RPC-backed action; day rate REQUIRED at creation (the RPC needs it), but rates are NEVER displayed here (money stays on /workers). The detail page (PM-gated) fetches crew (workers where contractor_id=id AND worker_type='dc', user session, id+name only) and renders the section only for the contractors route. contact-crew-section.test (RED first, 2: lists crew; add calls createWorker w/ dc+contractorId+dayRate). 669 unit / lint / typecheck / build green. No DB. Seam: remove/re-parent a crew member from the contact screen (today: deactivate on /workers).

## Field-First reskin — Unit 1 (revised): Worklist + Shutter (2026-06-14, SHIPPED to main)

Code-only, NO DB (deliberately decoupled — see below). The "looks generated" redesign, operator-approved direction. **APPLIED to working tree (not yet committed):** 17 files from the external design agent, integrated + drift-fixed against the live repo. (1) **Tokens** — globals.css now the single source of truth (Field-First surfaces/ink/status/radius/elevation + a Tailwind-v4 `--text-*` type ramp → text-display/title/heading/section/body/meta); classes.ts rewired to tokens + adds BUTTON*CAPTURE (amber hero bar) + CRITICAL_BADGE (reserved). (2) **Worklist** — NEW action-bands.ts (status→band, band order/labels, priorityRank sort), NEW worklist-row.tsx, work-package-list.tsx rewritten (action-state lens default for SA / deliverable lens for PM-super, triage filters, done folded), project page.tsx maps the list. (3) **Capture** — NEW use-phase-capture.ts (upload ENGINE extracted verbatim: downscale/offline-queue/idempotent upload→insert/retry/serialized-remove — behavior unchanged), NEW capture-sheet.tsx (shutter sheet: current phase pre-selected, 56px switch, 104px shutter, capture="environment"), phase-uploader.tsx → PhotoCaptureZone (file name kept for import stability), WP-detail page.tsx restructured shutter-first; all server reads unchanged. **NAV CONTRACT:** WP detail drops BottomTabBar (capture bar owns the thumb zone, back chip returns) — site-map.md + ui-conventions.md updated same-unit. **TESTS (path b):** ui-classes-spec65.test.ts pins rewritten to new strings; design-doctrine.test.ts invariants updated (no green-\*, DETAIL_TITLE display-tier+leading+no-truncate, worklist clamp, capture hero = amber not action-blue, critical slot reserved, no window.confirm, hero ≥44px); attention-card.test.tsx re-pinned to token classes. **DRIFT FIXES on apply:** glob dep → fs-walk in design-doctrine; noUncheckedIndexedAccess guards in phase-uploader; react-hooks/refs false-positive → destructured engine in capture-sheet; unused SECTION_HEADING dropped; over-broad confirm( regex narrowed to window.confirm. **PRIORITY DEFERRED:** the manual `priority` (ด่วน) flag, `priority_rank`, and `is_critical` columns are NOT added — page.tsx select drops them and passes reserved constants (tag + badge stay dark). The visible alignment lever (action bands) derives from `status`, so the reskin ships with ZERO schema change. Manual-priority (flag+rank+setter) and the critical-path engine become their own later specs (reskin-now-CP-later, see worklist-priority-alignment memory). **PRE-COMMIT REVIEW (adversarial, 5 dimensions, each finding verified):** capture-engine fidelity + security/RLS clean (0). Fixed 4 confirmed regressions: (a) capture-sheet retry button min-h-9→min-h-11 and (b) photo-remove button h-9 w-9→h-11 w-11 — the reskin had shrunk both below the 44px gloved-hands floor (spec 18/36); (c) deliverable-lens degraded path (PM/super, zero-deliverable project) now hides finished WPs behind a one-tap reveal, restoring spec-56 default; (d) removed a dead `? null : null` no-op in work-package-list. **RESTORED 3 anti-drift guards the reskin had silently dropped:** the sub-44px min-h-9 tap-floor pin (would have caught a+b), the green-* scan widened back to .ts+.tsx (+ring), and the phase-bar reserved-blue pin. **SHIPPED:** committed on branch `feat/field-first-reskin-unit-1` (5412753). 679 unit / typecheck / lint / next build green; built CSS confirmed the --text-\_ / token utilities generate. Visual signed off by operator (phone). Merged to main (f4105f4..f985427).

## Spec 91 — Field-First token sweep: whole-app consistency (2026-06-14, SHIPPED)

Code-only, NO DB. Operator "full pedal" session. Unit 1 reskinned only the shell+worklist+capture; the other ~54 .tsx files were still on the legacy raw palette (zinc/slate/blue/white) so the app read half-new. This sweep migrates them onto the Field-First tokens — NOT a redesign, it applies the design decisions already encoded in globals.css (coherent by construction). Spec + canonical legacy→token mapping: `docs/feature-specs/91-field-first-token-sweep.md`. **Method:** a Workflow fanned 54 single-file migration agents (each read the mapping + tokens, swapped colour/surface/elevation utilities only, preserved layout/behaviour/tap-sizes and intentional raw — photo-lightbox dark viewer, LINE-brand emerald, overlay scrims). 469 swaps, 0 failures. **Gap-closure:** added 4 tokens the sweep proved missing — `--color-action-soft` (blue-50 "ของฉัน"/selected ground), `--color-danger-strong` (red-700 destructive hover), `--color-done-edge` (emerald-300), `--color-done-ink` (emerald-900) — then tokenised the ~10 holdouts needing them (mine-tints, destructive hover/ring, success banner). Remaining raw = only intentional preserves (photo-lightbox, LINE login button, one dark logout hover). **Tests (path b):** re-pinned 4 component tests asserting old classes (notices→danger/ink, page-shell→bg-page/bg-card, refresh-button→ring-attn/ring-action, bottom-tab-bar→bg-card/text-action/.bg-action). **Review:** 5 adversarial reviewers over the diff for semantic hue-role mis-maps → 0 real findings (4 dismissed: border-ink coherent, fill-press hover correct, text-on-fill-on-danger matches CRITICAL_BADGE, text-input a false positive). 59 files, ~470 swaps. 679 unit / typecheck / lint / next build green; built CSS confirms the 4 new utilities generate. Merged to main (merge-auto, code-only). Visual spot-check = operator phone.

## Worklist next-action verbs (2026-06-14, SHIPPED — spec 91 follow-up)

Code-only, NO DB. Completes the Field-First worklist's promise ("every row states its next action") — Unit 1 shipped a status-only hint because the list lacked assignment data. TDD (failing test first). `action-bands.ts`: `nextActionLabel(status)` → `nextAction(status, hasContractor): { label, kind } | null` — a not_started WP with NO contractor now reads **"มอบหมายผู้รับเหมา"** (kind=assign) instead of a premature "take photos"; with a contractor → "เริ่มถ่ายรูป เตรียมงาน" (capture); in_progress → "ถ่ายรูป ความคืบหน้า" (capture); on_hold → wait; review/done → none. `worklist-row.tsx` maps kind→icon (assign=UserPlus, capture=Camera, wait=PauseCircle) + carries `hasContractor`. Data: project page.tsx select adds `contractor_id` → `hasContractor = contractor_id !== null` (cheap, existing column, ADR 0033). NEW `tests/unit/action-bands.test.ts` (8 cases, also back-fills coverage for deriveActionBand/byPriorityRank/groupByActionBand which shipped untested). 687 unit / typecheck / lint / next build green. Merged to main (merge-auto, code-only).

## Manual WP priority flag — the alignment lever (2026-06-14, SHIPPED, SCHEMA)

The operator's core goal: PM/super mark a WP's urgency; the worklist's ต้องทำ band sorts by it and lights the reserved ด่วน tag (Unit 1 left both inert). Distinct from the future critical-path engine (`is_critical`). Done autonomously under "full pedal" with prod `db:push` (change-management §1: agent pushes MERGED migrations + verifies). **Phase 1 — schema (migration 20260628000300, merged 97fc89d then pushed to prod):** `work_package_priority` enum (normal<urgent<critical), NOT NULL DEFAULT 'normal' column on work_packages (additive/transactional), and `set_work_package_priority` SECURITY DEFINER RPC mirroring set_work_package_contractor — PM/super only, site_admin/visitor → 42501. pgTAP 46 (9 asserts). Verified on prod: **db:test 46/46 files, 991 assertions, 0 failures**; db:types regenerated (+ prettier → clean 12-line diff). **Phase 2 — app:** `rankFromPriority(priority)` (action-bands, TDD), `priority-actions.ts` setter (validates + relays to the RPC, revalidates), `wp-priority-control.tsx` (3 RadioChips ปกติ/ด่วน/ด่วนมาก, optimistic + toast + revert, PM/super-gated on the WP detail page below the phase bar). Worklist now reads real `priority` → ด่วน tag + ต้องทำ sort LIVE (was constant). 688 unit / typecheck / lint / next build green. Remaining queued: critical-path engine (`is_critical`).

## Spec 92 — WP schedule + critical path, Units A–C (2026-06-14, SHIPPED, SCHEMA)

KANNA-style schedule foundation (operator direction: manual in-app entry + a KANNA-like calendar; Unit D calendar routed to the design agent). Full-pedal, autonomous incl. prod `db:push`. **Unit A — schema** (migration 20260628000400 + fix-forwards 000500 eval-once and 000600 nullable schedule params; all applied to prod): `work_packages.planned_start/planned_end` (nullable + window CHECK), `work_package_dependencies` table (finish-to-start; unique; no-self; RLS staff-SELECT, writes RPC-only), and 3 SECURITY DEFINER RPCs (PM/super only, SA/visitor 42501) — `set_work_package_schedule`, `add_work_package_dependency` (rejects self/cross-project/cycle via recursive-CTE reachability), `remove_work_package_dependency`. pgTAP 47 (16 asserts). **Verified on prod: db:test 47/47 files, 1007 assertions, 0 failures.** Two pgTAP-caught fixes folded in: eval-once wrap on the SELECT policy (anti-drift test 40), and nullable-default schedule params (so the action omits to clear). **Unit B — CPM engine:** `critical-path.ts` pure `criticalWorkPackageIds(items, edges)` — Kahn topo + forward/backward float pass, longest-path = critical, cycle-defensive, empty when no deps (5 tests). Project page computes it on read from planned windows + deps → worklist CRITICAL_BADGE (วิกฤต) now LIGHTS for path WPs (was constant false). **Unit C — input UI:** `schedule-actions.ts` (set schedule / add+remove dependency, relay to RPCs), `wp-schedule-panel.tsx` (planned start/end date inputs + depends-on chips/picker, optimistic + toast, PM/super-gated on WP detail). 693 unit / typecheck / lint / next build green. **Unit D (KANNA-style schedule calendar)** — see below.

## Spec 92 Unit D — schedule calendar (KANNA-style Gantt) (2026-06-14, SHIPPED, code-only)

The design agent's route produced a standalone _preview_ (Option E, bundled/encoded — not buildable, and its arrowheads were fixed-orientation/misaligned). Operator chose: **I reverse-engineer the preview**. Studied the readable CSS + intent (progress-fill bars, zebra/hover, past shading, behind-schedule dot, light critical path = red edge, curved hairline dep links that brighten on tap-to-highlight-chain, finish-to-start) and rebuilt the render engine cleanly on Field-First tokens. **New route `/projects/[id]/schedule`** (all staff; calendar chip added to the project-page header). `gantt-scale.ts` pure helper (date→x, month-padded domain, day ticks, วัน/สัปดาห์/เดือน period scales, Buddhist-era month labels; 7 tests). `schedule-gantt.tsx` client Gantt: sticky name column grouped by งวดงาน (amber headers), month/day axis, gridlines + past shade + dashed วันนี้ line, bars with status colour + progress fill + ด่วน chip + behind-schedule dot + critical red edge, finish-to-start dependency links as SVG with **`<marker orient="auto">` arrowheads** (fixes the preview's misaligned heads), tap-a-bar → highlight the transitive chain (sel/pred ring, others dim), legend, empty state. `schedule-today.ts` (Asia/Bangkok civil date, out of the component for the purity rule). Render smoke test (2). site-map updated (new route + nav). 702 unit / typecheck / lint / next build green. Visual acceptance = operator phone (preview can't auth); needs WPs with planned dates + deps set to show bars.

## Spec 93 — ตั้งค่า (Settings) hub + decluttered nav (2026-06-14, SHIPPED, code-only)

Operator: the bottom bar was crowded (PM/super had 5 tabs); move reference/account surfaces into a Settings menu. Evaluated each tab → daily deciders stay, the rest move. **New route `/settings`** (session-gated, all roles; getClaims pattern like /profile): บัญชี (→ /profile + LogoutButton, everyone) · ข้อมูลหลัก (→ /contacts, /workers) + การเงิน (→ /payroll) PM/super only. Reserved for a future ผลงานของฉัน (performance/gamification) section. **Bottom bar** now daily deciders + ตั้งค่า: SA = โครงการ/คำขอซื้อ/ตั้งค่า; PM/super = รอตรวจ/โครงการ/คำขอซื้อ/ตั้งค่า (was 5, now 4); procurement = คำขอซื้อ/ตั้งค่า. ติดต่อ + โปรไฟล์ dropped from the bar; ตั้งค่า lights on /profile,/contacts,/workers,/payroll (match). **Desktop HubNav** mirrors (deciders + ตั้งค่า; payroll/contacts moved in). Tests updated: bottom-tab-bar + hub-nav canonical-set pins. site-map updated (bottom tabs, /settings, /profile note). 704 unit / typecheck / lint / next build green. Homes the previously mobile-orphaned ค่าจ้าง + คนงาน. NEXT/exploring: gamification ("ผลงานของฉัน") + other Settings candidates (notifications, about/version).

## Spec 94 — Detail info sheet: slim headers, ⓘ bottom sheet (2026-06-15, SHIPPED, code-only)

Operator: "general information section is too large, can we put it on information page? like project info, wp info." AskUserQuestion → **bottom sheet** (reuse spec-78 BottomSheet) opened by an **ⓘ chip**, applied to **both** the project + WP detail headers. Pure UI relocation — NO DB/schema/route. Slim each sticky header (spec 62/64) to identity only; move context metadata into the sheet. Project sheet ข้อมูลโครงการ = the 5-row `<dl>` (client/lead/team/type/site). WP sheet ข้อมูลงาน = contractor block (display + WpAssignmentPanel reassign) + read-only รายละเอียดงาน (relocated from the body). **SHIPPED:** new `ProjectInfoButton` + `WorkPackageInfoButton` client components (ⓘ ICON_CHIP_MUTED + BottomSheet, caller-owns-open-state); project page.tsx drops the header `<dl>` → ⓘ chip in the actions slot (before the schedule chip, gated on any value present, all staff); WP page.tsx drops the header contractor block + the body `รายละเอียดงาน` `<details>` → `actions={<WorkPackageInfoButton …>}` gated on contractor||description. WP identity (code+name+status pill) stays in the header (WP-centric). TDD: project-info-button.test + work-package-info-button.test (RED→GREEN, 4 cases — ⓘ trigger present, metadata hidden until open, reassign trigger inside the WP sheet). Preserved: the unassigned amber AttentionCard + WP notes stay in the body. Seam: PM review WP page (/review/work-packages/[id]) not touched (one-component follow-up if wanted). 731 unit / lint / typecheck / next build green. Merged to main (merge-auto, code-only). Acceptance = operator phone (PM/SA-gated; preview env only renders /login). Spec: docs/feature-specs/94-detail-info-sheet.md.

## Spec 94 follow-up — BottomSheet portal fix (2026-06-15, SHIPPED, code-only)

Operator phone: "WP general information is hidden behind camera button." ROOT CAUSE: the ⓘ info BottomSheet renders inside the `sticky z-20` DetailHeader, which establishes a stacking context — so the sheet's `fixed z-50` overlay is capped at z-20 page-wide and the fixed amber capture bar (`z-40`, phase-uploader.tsx) painted over it. Same latent bug on the project page (tab bar z-40). FIX: `BottomSheet` now `createPortal`s its overlay to `document.body` (guarded for SSR; open starts false), lifting z-50 to the root stacking context. No consumer change (WpAssignmentPanel/RecordManager/ContactsTabs + the spec-94 info buttons all keep working; screen-query tests unaffected since portal targets the same document). tests/unit/bottom-sheet.test.tsx +1 (overlay parented to document.body even under a sticky-z-20 ancestor). 732 unit / lint / typecheck / build green. Pushed 6d04f61 (merge-auto, code-only). LESSON: a `fixed`+high-z overlay rendered inside a `sticky`/`fixed` ancestor with its own z-index is trapped in that ancestor's stacking context — portal modals to document.body.

## Spec 95 — iOS keyboard repaint guard (2026-06-15, SHIPPED, code-only)

Operator phone (WP page screenshot): "whenever user finished typing something and lower down keyboard, a part of screen will go missing, and cannot scroll to top." The spec-64 "keyboard case = next suspect." **ROUND 1 (309a245) shipped on the WRONG hypothesis** — assumed iOS scrolled the locked DOCUMENT and reset it to 0; operator: "not fixed." **Round-2 diagnosis (AskUserQuestion):** the screen RECOVERS ON ITS OWN the moment you scroll, and รีเฟรช clears it → it's a missing-REPAINT glitch, NOT a stuck scroll position. With the body LOCKED (overflow:hidden; PageShell's `<main>` the only scroller), iOS standalone WebKit resizes the viewport back when the keyboard closes but does NOT repaint the locked scroller — content (sticky header included) present but blank until a scroll forces a repaint. **FIX (round 2):** `ViewportScrollGuard` now reproduces the recovering scroll the instant the keyboard closes — `scroller.scrollBy(0,1)` then `scrollBy(0,-1)` next animation frame (position-preserving repaint nudge), on the `<main>` scroller. Same triggers (visualViewport `resize` back to ~full; `focusout` fallback) + same guard (skip while another editable is focused). No document-scroll reset (the position was never the problem). spec-64 body-lock + PageShell unchanged. interactive-widget viewport hint NOT used (iOS Safari doesn't honour it). TDD: tests/unit/viewport-scroll-guard.test.tsx (nudges scroller on blur with nothing focused; does NOT nudge while another field is focused). lint / typecheck / build green. Spec: docs/feature-specs/95-ios-keyboard-scroll-guard.md. LESSON: "blank area that recovers on scroll" = iOS missing-repaint after viewport resize, not a scroll offset — force a repaint (scroll nudge), don't reset position. Acceptance = operator iPhone (PWA: close/reopen or รีเฟรช after deploy).

## Spec 96 — add work photos from the gallery (2026-06-15, SHIPPED, code-only)

Operator: "Adding images can add from gallery as well." Only the WP CaptureSheet shutter was camera-locked (`capture="environment"` removes the gallery option from the iOS picker); the 3 attachment uploaders (delivery/invoice/PR-attachment) already had no `capture` so they were gallery-capable. FIX: keep the Field-First fast path (104px amber shutter stays `capture="environment"`) + ADD a secondary "เลือกจากคลังภาพ" `<label>` button (lucide Image, BUTTON_SECONDARY_MUTED + focus-within ring) wrapping a 2nd `<input type=file accept multiple>` with NO `capture` → opens the photo library; both feed the SAME usePhaseCapture handleFiles engine (downscale + offline queue + idempotent upload unchanged). Gallery input clears its own value after handleFiles (camera reset only touches fileInputRef) so the same photo can be re-picked. TDD: tests/unit/capture-sheet.test.tsx (engine mocked) — camera input keeps capture=environment + a no-capture gallery input exists; gallery selection routes through handleFiles. No DB. Spec: docs/feature-specs/96-add-photos-from-gallery.md. Acceptance = operator iPhone.

## Spec 97 — Contacts v2 Unit 7: contact documents (2026-06-15, SHIPPED, SCHEMA+STORAGE)

The last open Contacts v2 unit (operator picked it for "what next"). Attach an ID-card + bank-book photo to a paid contact (contractor/supplier/service_provider) and view on the contact detail page. PII + bank-adjacent → PM/super only, the contact_bank money-isolation posture. Clients excluded (mirrors bank's 3 FKs). **SHIPPED (migrations 20260629000000 + 000100 applied to prod under the db:push gate; pgTAP file 48):** (a) DB — enum `contact_doc_purpose`(id_card/bank_book); table `contact_attachments` (3 typed FKs + exactly-one-target CHECK like contact_bank, purpose, storage_path, uploaded_by, created_at) — ZERO authenticated access (RLS on, revoke all, no grants/policies) + APPEND-ONLY block trigger (P0001 on update/delete/truncate); `add_contact_document` SECURITY DEFINER RPC (PM/super gate 42501, exactly-one + purpose + path P0001, uploaded_by=auth.uid()) called on the USER session; private `contact-docs` bucket (image mimes, 25MiB) + path-bound PM/super storage INSERT policy ({kind}/{contactId}/… , objects.name-qualified). (b) App — CONTACT_DOCS_BUCKET; pure document-path.ts (buildContactDocPath + kind/purpose guards, shared client+server, server rebuilds path); documents.ts (admin read → latest id_card/bank_book → signed URLs, behind PM gate); addContactDocument action (pmSession gate, rebuild path, RPC on user session, revalidate detail); ContactDocumentsBlock (per-doc uploader reusing the invoice flow: preparePhotoForUpload → browser upload to contact-docs → action → refresh; current image via signed URL); wired on the contact detail page for the 3 paid kinds. TDD: contact-document-path.test + contact-documents-block.test. Hand-extended database.types.ts → db:types regen byte-matched (typecheck green both before+after). 743 unit / lint / typecheck / build green; db:test incl. file 48. Acceptance = operator iPhone (PM-gated). SEAMS: multiple docs per purpose / history (latest wins); document deletion (append-only); PDF docs (images only v1); clients excluded.

## Spec 98 — Coming-soon menu placeholders (2026-06-15, SHIPPED, code-only)

Operator: "can we include all menus we will have, then grey them out if they are coming soon?"
Two AskUserQuestion decisions: **placement = everywhere incl. the bottom bar** (over the
settings-only recommendation), and **seed set = ภาพรวม/Dashboard + ผลงานของฉัน + คลังเอกสาร**. The
mechanism is built once (a `comingSoon` flag + a shared badge); the seed list is trivial to grow/prune
via the look-loop. **SHIPPED (no DB):** (a) NEW `coming-soon-badge.tsx` — shared presentational
`เร็วๆนี้` pill, token-only (`bg-sunk`/`text-ink-secondary`/`text-meta`), renders in both
Server+Client. (b) `bottom-tab-bar.tsx` — `TabItem.comingSoon`; `ภาพรวม` (LayoutDashboard, href
`/dashboard` = marker, no route) added to SA_TABS + PM_TABS as the last content tab before ตั้งค่า
(PM→5 tabs, SA→4); renders a greyed non-link `<span>` (aria-disabled, Clock corner marker, aria-label
`… เร็วๆนี้`), skipped in the longest-prefix match loop so it never lights. Procurement stays lean
(spec-70 worklist) — NO coming-soon tab. (c) `hub-nav.tsx` — `HubNavItem.comingSoon`; `ภาพรวม` added
to PM_HUB_NAV + SA_HUB_NAV before ตั้งค่า; greyed non-link span + ComingSoonBadge, never current. (d)
`settings/page.tsx` — NEW เร็วๆนี้ section (all roles, above เกี่ยวกับ) with greyed non-link rows
ผลงานของฉัน (TrendingUp) + คลังเอกสาร (Files), badge where the chevron sits. Operator-on-SA sees all
three (ภาพรวม on bar+hub; ผลงานของฉัน+คลังเอกสาร in settings). **Tests (TDD, RED→GREEN):** new
coming-soon-badge.test.tsx (2); bottom-tab-bar.test.tsx pins updated + coming-soon cases (non-link
span, not aria-current, marker, procurement clean, no-404 placeholder); hub-nav.test.tsx pins updated

- coming-soon case (greyed non-link + badge, never current even when currentHref matches). Settings =
  verified-by-checklist (async Server Component; the badge + nav data carry the unit tests). 749 unit /
  lint / typecheck / next build green. Spec: docs/feature-specs/98-coming-soon-menus.md; site-map
  updated (nav-change contract). **SEAMS:** /dashboard + performance + documents routes unbuilt — flip
  `comingSoon` off + point href at the route to ship each (and move ผลงานของฉัน to its บัญชี home);
  procurement coming-soon (one-line add if wanted); a central nav registry (unify the 3 surfaces) if the
  count grows. **LESSON (cloud-PC):** bash `cd` into the repo PERSISTS across Bash calls and shifts the
  relative-path base for the **Write** tool (Read/Edit stayed on the primary dir) → a relative Write
  after the `cd` triple-nested into prc-ops/prc-ops/prc-ops. Use ABSOLUTE paths for Write. Acceptance =
  operator phone (greyed tabs/rows visible, non-tappable).

**FOLLOW-UP (same session):** the gamification/growth row renamed ผลงานของฉัน → **Nova** —
operator-chosen brand after a naming pass. Rationale: ผลงานของฉัน read like a KPI/job-evaluation and
was ego-centric (ของฉัน); brief became "cool English brand, easy for Thai mouths, transition to
gamification — learning/growth/fun, less about work." Nova (โนวา — a star flaring brighter =
breakthrough) won on pronunciation + cool + non-ego growth metaphor. Icon TrendingUp → Sparkles;
subtitle "เรียนรู้ เติบโต เลเวลอัพ". Code + spec 98 + site-map updated. Brand is elastic — holds
streaks/quests/levels later with no rename.

## Spec 99 — Split Contacts into three groups (2026-06-15, SHIPPED, code-only)

Operator: "ติดต่อ is quite packed, do you think it's better to separate out clients and suppliers?"
The old /contacts crammed FIVE tabs (ลูกค้า/ผู้ขาย/ผู้รับเหมา/DC/ผู้ให้บริการ) into one screen, with the
status filter showing on only three of them = packed + inconsistent. AskUserQuestion → operator chose
**three groups** (over "crews vs business orgs" two-way or "clients-only"): ลูกค้า | ผู้ขาย+ผู้ให้บริการ
(vendors you pay) | ผู้รับเหมา+DC (labor crews). Placement = three entries under ตั้งค่า › ข้อมูลหลัก,
NO new bottom-bar tabs (preserves the spec-93 declutter). **SHIPPED (no DB):** (a) NEW pure
`src/lib/contacts/groups.ts` — `ContactGroup` (customers/vendors/crews), `ContactTab`,
`CONTACT_GROUP_TABS` (group→ordered tabs), `STATUS_TABS` (contractors/dc/service). The testable seam.
(b) `contacts-tabs.tsx` parametrized with a `group` prop (row arrays now optional; chip row hidden for
a single-tab group; status filter via STATUS_TABS). (c) THREE routes — `app/contacts/{customers,
vendors,crews}/page.tsx`, each fetching only its tables + rendering `<ContactsTabs group=…>`;
`app/contacts/page.tsx` → `redirect("/contacts/customers")`. Detail route `/contacts/[type]/[id]`
unchanged (group segments customers/vendors/crews ≠ the type values → no collision; build confirmed).
(d) `settings/page.tsx` — the single ติดต่อ row became three: ลูกค้า (Users) · ผู้ขาย/ผู้ให้บริการ
(Store) · ผู้รับเหมา/DC (Hammer); คนงาน (HardHat) unchanged. **Tests (TDD):** new contacts-groups.test
(RED→GREEN, pins CONTACT_GROUP_TABS + STATUS_TABS); nav-back-affordance.test (spec 63 living nav doc)
updated — the 3 group pages are drill-downs w/ DetailHeader→/settings, bare /contacts EXCLUDED
(redirect). 754 unit / lint / typecheck / next build green. Spec:
docs/feature-specs/99-contacts-split-groups.md; site-map updated (nav-change contract). **WRINKLE
(accepted):** ผู้ให้บริการ carries status but sits in vendors → status filter shows on that one tab.
**SEAMS:** menu naming operator-tweakable; service-into-crews if strict status seam wanted; the inline
SA contractor quick-add (spec 31) still doesn't reach /contacts/crews. Acceptance = operator phone
(PM-gated; preview only renders /login).

## Spec 100 — ภาพรวม / Dashboard (role-aware overview) (2026-06-15, SHIPPED, code-only)

Operator picked "ภาพรวม / Dashboard" for "what next" — graduates the spec-98 coming-soon placeholder
to a live screen. **Map-then-spec** (1 Explore agent) charted the money model FIRST: budget =
`projects.budget_amount_thb` (project-level only, admin-read); spend = labor (`aggregateLaborCost`
over labor_logs) + materials (Σ `purchase_requests.amount` where status∈{purchased,on_route,delivered,
site_purchased} & not null — **partial**, since site PRs often record no price); all money is
admin-client behind `requireRole(PM_ROLES)`, SA never sees it (zero authenticated grant). This
collided with spec 98 putting ภาพรวม on the SA bar → AskUserQuestion → operator chose **role-aware**:
SA sees a money-FREE operational overview; PM/super additionally see budget vs spend. **SHIPPED (no
DB):** (a) pure `src/lib/dashboard/overview.ts` (`rollupProgress` → progress % + needsAttention =
on_hold/pending_approval WPs) + `spend.ts` (`SPEND_STATUSES`, `sumMaterials` null/status-gated,
`budgetStatus` no-budget/under/over). (b) `app/dashboard/page.tsx` — `requireRole(SITE_STAFF_ROLES)`,
operational reads on the user session (projects/work_packages, SA-readable); if `PM_ROLES`, an admin
pass adds budget + labor cost + PR amounts → portfolio total + per-project budget-vs-spend bars; live
projects only (active/on_hold); honest "ค่าวัสดุนับเฉพาะที่บันทึกราคา" caveat. Hub chrome (BottomTabBar

- plain header, no back chip, mirrors /settings). (c) **Nav graduation:** ภาพรวม flipped from
  coming-soon to a live tab/hub link (SA + PM, not procurement); since it was the ONLY top-level
  coming-soon item, the bottom-bar/hub `comingSoon` mechanism was RETIRED (flag + Clock marker +
  match-loop skip removed — no dead/untested code). The coming-soon concept lives on in ตั้งค่า rows
  (Nova, คลังเอกสาร) via ComingSoonBadge (unchanged). **Tests (TDD):** dashboard-overview.test +
  dashboard-spend.test (RED→GREEN); bottom-tab-bar + hub-nav tests updated (ภาพรวม now a live link that
  lights on /dashboard; coming-soon cases removed); nav-back-affordance += /dashboard as NON_DETAIL
  (primary tab). 764 unit / lint / typecheck / next build green. Spec:
  docs/feature-specs/100-dashboard-overview.md; site-map + README updated. **LESSON:** the spec-63
  nav-back-affordance test greps page.tsx SOURCE for the literal "DetailHeader" — a code COMMENT saying
  "no DetailHeader" tripped the NON_DETAIL `not.toContain` assertion; reword comments to avoid the pinned
  token. **SEAMS:** material spend partial until PR amounts captured; no per-WP budget (project-level
  compare); labor spend uses live logs not the frozen snapshot; archived/completed projects hidden;
  desktop HubNav strip not rendered on /dashboard (mirrors /settings). Acceptance = operator phone
  (money half needs a PM/super account; SA sees the operational half).

## Spec 101 — Procurement depth U1: suppliers screen + desktop nav (2026-06-15, SHIPPED, code-only)

Operator "what next" → Purchase → **procurement role depth** → chose "both" (suppliers screen + nav AND
project visibility). Map-then-spec (1 Explore agent) showed the two halves carry very different risk, so
SPLIT: this is **Unit 1** (app-only, no migration); project visibility = Unit 2 (needs a projects-SELECT
migration + a read-only audit of the capture-heavy WP surfaces — reverses spec 70's WP-detail bounce).
**Why U1 needs no DB:** suppliers RLS already admits pm/procurement/super (spec 33/81); procurement just
lacked a SCREEN + nav. **KEY SAFETY:** the contact detail page shows the money-isolated bank block
(PM/super), so procurement's supplier rows must NOT link there — they edit INLINE only; and procurement
can't read service_providers, so its view is SUPPLIERS-ONLY (not the full vendors group). **SHIPPED:**
(a) `role-home.ts` BACK_OFFICE_ROLES = [PM, super, procurement] (excludes SA). (b) `lib/contacts/groups.ts`
new `suppliers` group = ["suppliers"]. (c) `contacts/actions.ts` extracted generic `roleSession`;
createSupplierRecord/updateSupplierRecord now gate `backOfficeSession` (others stay PM-only). (d)
`contacts-tabs.tsx` new `linkDetails` prop (false → suppliers rows carry no rowHref, inline edit only).
(e) `contacts/vendors/page.tsx` gate PM_ROLES → BACK_OFFICE_ROLES; procurement → group="suppliers"
linkDetails=false, suppliers fetch only (service skipped), title ผู้ขาย, back→/requests; PM unchanged. (f)
Nav: PROCUREMENT_TABS += ผู้ขาย (Store → /contacts/vendors; longest-prefix beats the ตั้งค่า /contacts
match so it lights on the screen); new PROCUREMENT_HUB_NAV (คำขอซื้อ·ผู้ขาย·ตั้งค่า) wired on /requests
(was null). **Tests:** contacts-groups pin (suppliers group); bottom-tab-bar pin += ผู้ขาย + lights on
/contacts/vendors; hub-nav pins PROCUREMENT_HUB_NAV. 766 unit / lint / typecheck / next build green. Spec:
docs/feature-specs/101-procurement-suppliers-depth.md; site-map + README updated. Acceptance =
procurement-user phone (lands /requests, taps ผู้ขาย, adds/edits a supplier inline; sees NO bank, NO
detail page). **NEXT: Spec 102 = procurement project visibility** (projects SELECT migration + /projects
gate + read-only WP-list pass; operator-gated db:push).

## Spec 102 — Procurement depth U2: read-only project visibility (2026-06-15, SHIPPED, SCHEMA)

The 2nd half of "procurement depth". Procurement processes purchases against project/WP context but
couldn't read `projects` at all. **Read-only, purpose-built, zero regression:** procurement does NOT
get the SA/PM worklist (capture-links + SA action verbs); the project page `ctx.role === "procurement"`
**early-returns** a simple read-only WP list (name+code+status pill, no links) — SA/PM path byte-
unchanged. Capture stays out: WP detail + schedule stay SITE_STAFF_ROLES (procurement bounces); no
reports/gear/schedule/ⓘ chips, no bank. **Migration 20260630000000** = one `ALTER POLICY "projects
readable by privileged roles"` adding procurement (keeps the name + eval-once `(select …)` wrapped form
so policies_are + eval-once anti-drift stay green; INSERT/UPDATE stay super_admin). work_packages SELECT
already admitted procurement (spec 70). No schema/type change → db:types unaffected. **App:**
`PROJECT_VIEW_ROLES` (site staff + procurement) gates /projects + /projects/[id] only; /projects gets a
จัดซื้อ kicker + PROCUREMENT_HUB_NAV; nav PROCUREMENT_TABS + PROCUREMENT_HUB_NAV += โครงการ (procurement
bar now 4 tabs: คำขอซื้อ·โครงการ·ผู้ขาย·ตั้งค่า). **pgTAP 07** +1 (plan 31→32): procurement SELECTs
projects (E.5); visitor-sees-nothing unchanged. 766 unit / lint / typecheck / next build green; db:push

- db:test under the operator gate. Spec: docs/feature-specs/102-procurement-project-visibility.md;
  site-map + README updated. **Procurement depth COMPLETE** (U1 suppliers+nav, U2 project read-only).
  Acceptance = procurement-user phone (taps โครงการ → project list → a project → read-only WP list; can't
  open a WP/schedule). SEAMS: flat list (no งวดงาน grouping); no ⓘ client-info (kept out to avoid leaking
  context).

## Spec 103 — Capture the on-site purchase amount (2026-06-15, SHIPPED, SCHEMA)

"Go on" → make the dashboard's material spend real. **Map-then-spec (1 Explore agent) found
record_purchase ALREADY captures amount end-to-end** (form field + action p*amount + RPC
coalesce-preserve) — the ONLY gap was site purchases (record_site_purchase wrote amount=NULL, spec 66
never captured it), so on-site cash buys never counted in spec-100 sumMaterials. So this unit = add
amount to the site-purchase path only. **Explore-quote trap caught:** the agent quoted record_site*
purchase from 20260622000500, but a LATER migration 20260625000500 re-created it to also set
received_by_id — verified via grep before DROP+CREATE (would've regressed received_by_id otherwise).
**SHIPPED:** migration 20260630000100 DROP+CREATE record_site_purchase + `p_amount numeric default null`
(CREATE OR REPLACE can't add a param) — body = the CURRENT (000500) version + amount (positive-when-
given check, amount in INSERT + audit payload), re-grant execute to authenticated (drop drops grant);
amount stays RPC-only-write (zero authenticated grant). App: validate-site-purchase +amount (positive/
finite when given); recordSitePurchase action +amount (omit→RPC default); site-purchase-form +optional
จำนวนเงิน field. database.types hand-extended (record_site_purchase Args +p_amount?) → db:types regen
reconciled. **Tests:** validate-site-purchase.test value+amount +1 case; pgTAP 33 sig pin →5 args +3
(plan 27→30: records w/ amount, amount persisted, amount≤0 throws). 767 unit / lint / typecheck / build
green; db:push + db:test under operator gate (49 files / 1025 asserts). Spec:
docs/feature-specs/103-site-purchase-amount.md. **Amount stays OPTIONAL everywhere** (record_purchase +
site purchase) — dashboard material spend still "counted where priced"; making it required = separate
workflow decision. Acceptance = operator phone (record a site purchase with a price → it shows in
dashboard spend). NEXT candidates: make amount required (complete material spend), billing งวดงาน
(operator-decision-blocked), backup/restore drill, app-feel motion.

## Spec 104 — Procurement worklist as a buyer's pipeline (2026-06-15, SHIPPED, code-only)

Operator design Q "what should the procurement UX comprise" → I framed procurement as a PIPELINE
operator (approved→order→track→receive) → operator picked "build the pipeline worklist" (#1). App-only,
no DB. **SHIPPED:** pure `src/lib/purchasing/procurement-pipeline.ts` — procurementBand(status):
approved→to_order, purchased/on_route→in_transit, delivered/site_purchased→received,
requested→awaiting_approval, rejected/cancelled→null; PROCUREMENT_BANDS (to_order is the one hot band)

- groupByProcurementBand (band order, drops empty/unbanded, preserves input order). /requests page: for
  ctx.role==="procurement" the list renders as banded sections (รอสั่งซื้อ hot/amber first, then
  กำลังจัดส่ง/ได้รับแล้ว/รออนุมัติ) instead of the flat pending-first list; extracted a shared cardFor(r)
  closure so flat (PM/SA) + banded (procurement) render identical cards — PM/SA OUTPUT UNCHANGED; ของฉัน
  filter hidden for procurement (never owns a request); no data-fetch/RLS change. Tests:
  procurement-pipeline.test (status→band, exclusions, hot, grouping). 772 unit / lint / typecheck / build
  green. Spec: docs/feature-specs/104-procurement-pipeline-worklist.md. SEAMS: filing-gap band
  (รอแนบใบเสร็จ = delivered-but-no-invoice) deferred (needs an attachment-presence query); FIFO order
  within to_order; the rest of the procurement-UX vision still open — buyer overview (pipeline counts +
  overdue ETAs + outstanding PO ฿), per-supplier open-POs + spend, price history. Acceptance =
  procurement-user phone (worklist shows รอสั่งซื้อ first).

## Spec 105 — Procurement buyer summary strip (2026-06-15, SHIPPED, code-only)

"Go on" → procurement-UX vision #2 (buyer overview), realized as a SUMMARY STRIP on the worklist (not a
separate screen — one glance: workload + slipping, then the work). App-only, no DB. `procurement-
pipeline.ts` +procurementSummary(rows, todayIso) → {toOrder (approved), inTransit (purchased/on_route),
overdue (in-transit with eta<today)}. /requests: for procurement a 3-tile strip above the bands —
รอสั่งซื้อ (hot/amber) · กำลังจัดส่ง · เกินกำหนด (red when >0), computed from already-fetched rows +
bangkokTodayISO() (reused from schedule-today.ts); small BuyerStat tile. No new data/RLS. **Money
deliberately excluded:** outstanding-PO ฿ needs an admin amount read (amount = money, not in list
columns) → recorded seam; counts+overdue come from status+eta (already readable). Tests:
procurement-pipeline.test +procurementSummary (counts, overdue, eta==today not overdue, empty). 775
unit / lint / typecheck / build green. Spec: docs/feature-specs/105-procurement-buyer-summary.md.
Procurement UX now: pipeline worklist (104) + buyer summary (105). REMAINING vision: outstanding-฿
tile (admin read), per-supplier open-POs + spend, price history, filing-gap band. Acceptance =
procurement-user phone (strip atop คำขอซื้อ).

## Spec 106 — Outstanding-PO ฿ tile (2026-06-15, SHIPPED, code-only)

"Go on, finish the 2" (1/2). Completes the spec-105 buyer summary with the deferred ค้างจ่าย tile.
App-only, no DB. procurement-pipeline.ts +sumOutstanding(rows) (sum non-null amounts). /requests: for
procurement, an admin-client read of `amount` for the IN-TRANSIT request ids (purchased/on_route =
committed, not received), summed → 4th tile ค้างจ่าย (฿); strip now 2×2. **Money posture:** admin read
is gated to the procurement branch (if(isProcurement) — never runs for SA/PM here); procurement is
back-office (enters amounts via record_purchase) so seeing the committed total is appropriate; no
authenticated grant on amount added, admin client is the only reader. BuyerStat value → string; baht()
formatter. Tests: sumOutstanding (sums non-null, empty→0). 777 unit / lint / typecheck / build green.
Spec: docs/feature-specs/106-procurement-outstanding-tile.md. SEAM: ค้างจ่าย counts only priced POs
(amount optional). NEXT (2/2): per-supplier open-POs + spend (spec 107).

## Spec 107 — Per-supplier spend chip (2026-06-15, SHIPPED, code-only)

"Finish the 2" (2/2). Supplier intelligence on procurement's suppliers screen. App-only, no DB. Pure
`src/lib/purchasing/supplier-spend.ts` aggregateSupplierSpend(prs) → Map<supplier_id,{spend,open}>:
spend = Σ amount over committed (in_transit+received) POs, open = in-transit count; site purchases
(no supplier_id) ignored. record-manager.tsx: RecordBadge tone += "neutral" (info chip, not warning;
bg-sunk text-ink-secondary; amber/red unchanged). contacts-tabs.tsx: optional supplierBadge(id) prop →
suppliers RecordManager rowBadge. /contacts/vendors (procurement branch only): admin-read committed
purchase_requests (supplier_id, amount, status; bounded to purchased/on_route/delivered), aggregate →
per-row chip "฿12,500 · 2 ค้างส่ง". **Money posture:** admin read gated to the procurement branch
(if(!isManager); SA can't reach the BACK_OFFICE-gated page); procurement records purchases → may see
spend; no authenticated amount grant added. PM/super vendors view unchanged. Tests: supplier-spend.test
(committed-only, open count, supplier-less/rejected ignored, empty). 780 unit / lint / typecheck / build
green. Spec: docs/feature-specs/107-supplier-spend.md. SEAMS: priced-POs-only (amount optional);
JS-aggregation (SQL group-by = scale refinement); PM/super no chip; price-history later.

**PROCUREMENT UX COMPLETE (this arc, specs 101–107):** worklist pipeline + buyer summary
(workload/overdue/outstanding-฿) + suppliers master w/ spend chips + read-only projects + price capture
(record_purchase + site). Remaining ideas only: price-history, filing-gap band, managers' supplier
spend, partial deliveries/line items. Session total: specs 98–107 (10 specs), 3 prod migrations.

## Spec 108 — Procurement desktop grid worklist (2026-06-15, SHIPPED, code-only)

Operator: "record review on tablets/PC — purchase team uses bigger screens." → I confirmed it already
works responsively (pages widen to 6xl/7xl, HubNav on desktop) but is phone-first → researched
**Airtable** (WebSearch/WebFetch: grid view + **sidesheet** expand w/ prev/next + grouped/side-by-side
record detail) → built a desktop mockup (grid + click-to-expand sidesheet) via the visualize tool →
operator approved "build it phased." **Phase 1 (this) = the grid; phase 2 (spec 109) = the sidesheet.**
App-only, no DB. NEW `components/features/procurement-grid.tsx` (presentational server): dense table
grouped by band (spec 104), cols รายการ(item+PR#+WP) · ผู้ขาย · สถานะ/ETA · จำนวนเงิน; item cell →
/requests/[id]; reuses purchaseRequestStatusPillClasses + PURCHASE_REQUEST_STATUS_LABEL. /requests:
procurement responsive split — cards on phone (lg:hidden), grid on tablet/PC (hidden lg:block), summary
strip above both. Amount admin read widened to ALL visible rows → amountById map (one read,
procurement-gated) feeding the grid จำนวนเงิน + the ค้างจ่าย tile. Money posture unchanged (admin read
gated to isProcurement; no authenticated grant). Presentational → checklist; pure helpers already
tested. 780 unit / lint / typecheck / build green. Spec: docs/feature-specs/108-procurement-desktop-
grid.md. NEXT (phase 2, spec 109): row → sidesheet drawer (record detail + action zones + prev/next),
the Airtable expand. Session: specs 98–108 (11), 3 migrations.

## Spec 109 — Procurement record-review sidesheet (Airtable arc, phase 2) (2026-06-15, SHIPPED, code-only)

Phase 2 of the big-screen Airtable arc (phase 1 = spec 108 grid). **Operator picked approach (b)**
(AskUserQuestion: light read-only review drawer vs (a) full action zones inside a Next intercepting
`@modal` route) — so NO intercepting/parallel routes, a client drawer fed by data the grid already
carries. App-only, no DB. **SHIPPED:** (1) pure `src/lib/purchasing/grid-record-nav.ts` —
`flattenRecordOrder(groups)` (bands → one reading-order list, empty bands dropped) +
`adjacentRecordIds(order, id)` → `{prevId, nextId, index, total}`, **non-wrapping** (null at the
ends, mirrors the spec-50 lightbox; absent id → index -1). TDD-first (8 unit RED→GREEN). (2)
`bottom-sheet.tsx` (spec 78) +`side?: "bottom" | "right"` prop (default bottom, back-compat) — right =
full-height panel slid in from the right, same scrim/Escape/scrim-click/portal-to-body/focus-on-open
shell; `+@keyframes sheet-in-right`/`.sheet-panel-right` in globals.css (reduced-motion-gated, mirrors
`.sheet-panel`). (3) `procurement-grid.tsx` is now the **interactive grid** (`"use client"`): same
dense banded table, but the item cell is a **button** opening the review drawer (selected row =
`bg-action-soft`); the drawer = persistent top bar **‹ ก่อนหน้า · n/total · ถัดไป ›** + header
(PR#, never-truncated subject, status + priority pills) + facts (qty, WP code·name, supplier, ฿amount,
needed_by, ETA) + **reused `PurchaseRequestTracker`** stepper (hidden for `site_purchased`, mirroring
the detail page) + **ดำเนินการ →** Link to `/requests/[id]` (act on the full page). (4) `/requests`
page: builds serializable `ProcurementGridRecord[]` groups (each row enriched with `wp_code`/`wp_name`
from `wpById` + `amount` from `amountById`) and passes `<ProcurementGrid groups={...} />`; the old
function props (`wpName`/`amount`) are gone — **a client component can't take server closures**, so
the data is baked into the (serializable) rows. **Money posture unchanged** (amount = admin read
gated to `if(isProcurement)`; never SA/PM; no authenticated grant; amount baked into rows only inside
that branch). Phone card pipeline (104) + WP-detail flows byte-unchanged; grid is `hidden lg:block`.
788 unit (+8) / lint / typecheck / build green; **no migration → pgTAP 1025 baseline untouched**.
Spec: docs/feature-specs/109-procurement-record-review-sidesheet.md. **NOT preview-verified**
(procurement-gated route, preview env only renders /login — same as 81/108) → acceptance = procurement
user on a PC: click a grid row → drawer opens with the record; ‹/› steps through; ดำเนินการ → opens
the detail. **SEAMS:** approach (a) full action-zones-in-drawer via `@modal` intercepting route
(URL-updating, refresh-deep-linkable) deferred — Next 16 intercepting/parallel-routes research owed
first; keyboard arrow prev/next + swipe-dismiss + full tab-trap recorded (BottomSheet focus-trap seam);
grid columns still fixed (no sort/column-pick).

## Spec 110 — Procurement worklist filters + priority sort (2026-06-15, SHIPPED, code-only)

Operator: "should the purchasing team get filters, and what?" → bands already cover STAGE (spec 104),
so filters = the cross-cutting slices bands can't express. **AskUserQuestion #1:** picked all four —
by supplier · by project · overdue-only · priority sort. Operator follow-up "how about statuses?" →
**AskUserQuestion #2:** "surface rejected/cancelled" (the real gap: rejected+cancelled are banded OUT
of the procurement pipeline → invisible in the worklist today). App-only, no DB (projects fetch is an
RLS-admitted read since spec 102). **SHIPPED:** (1) pure `lib/purchasing/worklist-filter.ts` (TDD,
+16 unit) — `matchesProcurementFilter` (AND-composes supplier/project/overdue/status; overdue =
in_transit band AND eta<today, eta==today NOT overdue), `sortByPriority` (stable critical→urgent→
normal), `distinctSuppliers`/`distinctProjects` (picker options from the UNFILTERED set),
`buildWorklistQuery` (URL serialize, drops empties — shared by the server overdue-tile Link + the
client `<select>`s so axes compose). (2) `pending-order.ts` exports `PR_PRIORITY_RANK` (reused by the
sort — one rank, no dup). (3) `procurement-filters.tsx` (`"use client"`): supplier+project+status
`<select>`s + ล้างตัวกรอง; onChange → `router.push(buildWorklistQuery(...))`. (4) `procurement-grid.tsx`:
Group meta broadened to a structural `WorklistGroupMeta {band:string;label;hot}` so a synthetic
single-status group (incl. rejected/cancelled) renders alongside real bands. (5) `/requests`:
**server-side URL-param filtering on the shared `myRequests`** → phone bands + desktop grid both get
it, deep-linkable; status filter → ONE flat priority-sorted group (overrides banding, surfaces the
banded-out history); priority sort within every band; **summary strip stays on the UNFILTERED set**
(stable glance); **เกินกำหนด tile = overdue toggle** (BuyerStat +href/active = Link with pressed ring);
distinct empty notices (ไม่พบ…ตามตัวกรอง vs ยังไม่มี…). Procurement-only — SA/PM flat list untouched.
**Money posture unchanged** (overdue/supplier/status are non-money; amount admin read still gated to
isProcurement, computed unfiltered; ค้างจ่าย stays a read-only money glance). 804 unit / lint /
typecheck / build green; **no migration → pgTAP 1025 untouched**. Spec:
docs/feature-specs/110-procurement-worklist-filters.md. **NOT preview-verified** (procurement-gated,
preview only /login) → acceptance = procurement user (PC/phone): pick supplier→only that vendor; pick
project→only that site; tap เกินกำหนด→late POs; status→that status incl. rejected/cancelled; critical
on top within bands; URL carries the filter. **SEAMS:** single-select per axis (multi-select +
saved-views later); only เกินกำหนด tile is a toggle; priority sort default-on (no oldest-first toggle).

## Spec 111 — Compact process mini-bar in the grid status cell (2026-06-15, SHIPPED, code-only)

Operator noticed the desktop grid สถานะ cell shows only a pill while the process bar
(PurchaseRequestTracker) appears on cards + detail + the spec-109 drawer. **AskUserQuestion: "add a
compact mini-bar"** (rejected: full stepper in a ~20% cell breaks density; bands already carry stage;
rejected/cancelled don't fit a linear bar — pill names all 8 states). App-only, no DB. **SHIPPED:**
(1) pure `lib/purchasing/order-stages.ts` (TDD, +7 unit) — `ORDER_STAGES` + `orderStageStates(status)`
→ per-stage `{stage, state(done|pending|rejected|cancelled), isCurrent, reached}`; this is the
stage-state logic EXTRACTED from PurchaseRequestTracker so the tracker + the new mini-bar share ONE
source of truth (no duplicated STATUS_RANK — spec-65 consolidation ethos). (2) `purchase-request-
tracker.tsx` refactored to consume the helper + neighbour-state connector fill; **data-stage/data-
state/label/date/ETA output byte-identical** — the spec-22 tracker test (6 cases pinning all states)
is the regression guard, stayed green. KEY: derived the right-connector fill from `steps[i+1].state
=== "done"` (no rank/rejected vars needed) and the ring from `isCurrent && state!=="rejected"`. (3)
NEW `purchase-mini-stepper.tsx` — DECORATIVE (`aria-hidden`) 5-segment bar (reached=done-strong,
rejected=danger, else edge; no labels/dates); the pill stays the accessible status. (4) `procurement-
grid.tsx`: สถานะ cell = mini-bar above the pill + ETA (grid only; cards/detail/drawer keep the full
tracker). 811 unit / lint / typecheck / build green; **no migration → pgTAP 1025 untouched**. Spec:
docs/feature-specs/111-grid-mini-stepper.md. **NOT preview-verified** (procurement-gated, preview only
/login) → acceptance = procurement user PC: each grid row's สถานะ cell shows a 5-segment bar filled
to its stage + the pill; tracker behaves identically everywhere else. SEAMS: 5-segment fill (no
per-stage dots/labels — minimal for density); rejected/cancelled show short/red, pill carries the
exact terminal word.

## Spec 112 — Band-relative row health color in the procurement grid (2026-06-15, SHIPPED, code-only)

Operator pushed back on naive grid coloring: "coloring urgent red doesn't help if they already
ordered the things — design better, think outside the box, ultrathink." KEY REFRAME: request
priority is the REQUESTER's lens, stale once ordered; the buyer's grid color should encode the
BUYER's TIME pressure, **band-relative** (red MEANS a different thing per band). **AskUserQuestion:
"band-relative health RAG"** (over late-only / buyer-SLA-aging). App-only, no DB. **SHIPPED:** (1)
pure `lib/purchasing/row-health.ts` (TDD, +14 unit) — `rowHealth(status, eta, neededBy, todayIso)` →
late|at_risk|on_track|waiting, band-aware via procurementBand: **to_order** (not ordered) pressure =
needed_by (past→late, ≤7d→at_risk, else on_track, no-need→on_track); **in_transit** (ordered) = ETA
past→late, ETA>needed_by→at_risk (lands late), else on_track, no-eta→on_track (request urgency
IRRELEVANT here — the operator's whole point, so rowHealth takes NO priority input); **received**→
on_track; **awaiting_approval/rejected/cancelled**→waiting (not the buyer's move). `HEALTH_SOON_DAYS=7`;
`daysUntil` = UTC-midnight ISO diff (tz-stable). +`rowHealthLabel` Thai (hover title). (2) grid: each
data row's FIRST cell gets `border-l-4` + a health color (late=danger, at_risk=attn, on_track=
done-strong, waiting=edge) + `title` reason; ETA turns text-danger when late. Used all-sides color
tokens (border-danger etc.) NOT border-l-<token> (don't rely on left-specific color generation). (3)
`/requests` passes `today=bangkokTodayISO()` into the grid so health uses the Bangkok civil date, not
the client clock. **Three orthogonal grid signals now:** band=action · mini-bar=stage · color=on-time.
Grid only — pill/mini-bar/cards/band-header unchanged. 825 unit / lint / typecheck / build green; **no
migration → pgTAP 1025 untouched**. Spec: docs/feature-specs/112-grid-row-health-color.md. **NOT
preview-verified** (procurement-gated) → acceptance = procurement user PC: not-ordered-past-needed_by
glows red, shipment-past-ETA red, shipment-landing-after-need amber, on-track green, awaiting neutral;
hover explains. SEAMS: SOON window fixed at 7d (no per-project SLA); received→amber on missing invoice
(filing gap) needs attachment query — deferred; color legend + health on phone cards later; in_transit
no-ETA reads on_track (an "unmanaged PO" amber is a later refinement).

## Spec 113 — Grid health smoke test + visual preview (2026-06-15, SHIPPED, code-only)

Operator on spec-112: "I only see green — add a smoke test so we can review all possible cases."
**DIAGNOSIS: not a code bug.** rowHealth is date-driven (to_order needs needed_by, in_transit needs
eta); pilot rows mostly have those NULL → every row classifies on_track (green). The color wiring is
correct. **SHIPPED:** (1) `tests/unit/procurement-grid-health.test.tsx` — renders ProcurementGrid
with synthetic rows hitting every band/health, asserts all four health border colors (border-danger/
attn/done-strong/edge) + the late-ETA text-danger render (regression guard against a one-color wash).
(2) `src/app/grid-preview/page.tsx` — **TEMPORARY** public page (no auth, synthetic data, fixed
today) rendering the grid across every case + a legend, for operator review on the live deploy (the
spec-38 /design-preview precedent); DELETE after review. 826 unit / lint / typecheck / build green;
**no migration → pgTAP 1025 untouched**. Spec: docs/feature-specs/113-grid-health-smoke-preview.md.
**DEV-ENV FINDING (recorded, not prod-affecting):** the cloud-PC `pnpm dev` preview only emits the
`@theme inline` token block (--color-card) and NOT the second `@theme` block (--color-danger/attn/
done-strong/edge resolve to "" on :root), so colors render grey/transparent in LOCAL dev — could not
screenshot-verify the colors here. Production build compiles both @theme blocks (the live app's pills/
links are token-colored), so the bars DO render on the deploy; verification was via the unit smoke
test (class wiring) + the rowHealth tests (logic) + token-name confirmation in globals.css.
Acceptance = operator opens /grid-preview on the LIVE deploy → sees red/amber/green/grey, then it's
deleted. **The real takeaway for live data: coloring appears once requesters set needed_by and
procurement/AppSheet set eta** — making needed_by more prominent on the request form is a follow-up.

## Spec 114 — Enrich the review drawer + in-place buyer actions (2026-06-15, SHIPPED, code-only)

Operator on the spec-109 drawer: "too little info, and can they edit right away? is it wise?" KEY
SCOPING: the grid/drawer is **procurement-only** → approve/reject/cancel never appear here (PM-only,
spec 70); the only actions in play are the buyer's own (record purchase / ship / invoice / delivery
photo) — form-based, audited, reversible → safe in place. **AskUserQuestion: "enrich + in-drawer
actions."** App-only, no DB. **SHIPPED:** (1) pure `lib/purchasing/drawer-actions.ts` (TDD, +6 unit)
`procurementDrawerActions(status)` → {record(approved), ship(purchased), invoice(purchased+),
deliveryPhoto(on_route/delivered)} (mirrors the detail page's back-office arms). (2) ProcurementGridRecord
+8 fields (project_id, requested_by, requester_name, notes, decision_comment, received_by,
delivery_note, doc_count). (3) page: fetch `notes` alongside PR_LIST_COLUMNS; one batched
attachment-count (purchase_request_attachments_current grouped in JS) → doc_count; fetch suppliers
once (procurement); enrich records; pass `suppliers`+`userId` to the grid. (4) drawer rebuilt
(DrawerBody, keyed by record.id so action forms RESET on prev/next — no half-typed amount carries
over): **PINNED header** (sticky top-0: prev/next + PR#/item/status — the guardrail so a stepping
buyer can't act on the wrong row), richer read-only (requester+ของฉัน, ขอเมื่อ, note, rejection reason,
ผู้รับของ/delivery note, เอกสาร count), and **in-place action forms** (existing PurchaseRecordForm/
Ship/InvoiceUploader/DeliveryPhotoUploader — they router.refresh() → page re-renders → still-open
drawer reflects the new status/band), + a เปิดรายละเอียดทั้งหมด → link for galleries. New grid props
suppliers/userId are OPTIONAL (spec-113 preview/smoke pass neither; uploaders guarded on
userId/project_id; factories updated with the 8 new fields). **WHY WISE (operator's Q): decisions are
structurally absent here; remaining actions are audited+reversible forms; the wrong-row hazard is
closed by the pinned header; amount stays a deliberate field.** Money posture unchanged. 8xx unit /
lint / typecheck / build green; no migration → pgTAP 1025 untouched. Spec:
docs/feature-specs/114-drawer-enrich-and-actions.md. NOT preview-verified for colors (dev-token glitch)
but build guards the client/server boundary (action components render in the client drawer). Acceptance
= procurement PC: open a row → fuller record + record/ship/attach IN the drawer, grid updates without
leaving, prev/next still steps, full page one link away. SEAMS: doc COUNT not galleries; band-jump
after action expected; decisions stay page+PM-only.

## ADR 0044 + Spec 115 — Purchase orders (grouping tickets) — DESIGN LOCKED, build pending (2026-06-16)

Operator asked how admins handle a purchase covering **more than one ticket** + partial delivery.
Found the gap: the only procurement entity is `purchase_requests` (one ticket = one line/WP/qty,
atomic delivery) — **no PO object**; a buyer ordering 5 tickets from one supplier records 5×, and the
per-ticket amount means one invoice total is split by hand. Partial-**across**-tickets already works
(each ticket delivers independently) but ungrouped; partial-**within**-a-ticket (split qty) is
unmodelled (a later receipts unit). Two AskUserQuestions locked the design: **(1) build PO grouping**
(over partial-receipts / both / workaround); **(2) per-ticket prices** (PO total = sum, over
PO-total-+-split / lump) — preserves per-WP material spend (specs 100/103/106 read amount per ticket).
**ADR 0044 (Accepted)** + **spec 115** written: new `purchase_orders` table (po_number seq, supplier_id
FK + snapshot, eta, ordered_at, notes, created_by; **no money column** — total is computed);
`purchase_requests.purchase_order_id` nullable FK; **atomic SECURITY DEFINER `create_purchase_order`**
(back-office gate on the AUTHENTICATED session per the spec-68 lesson; per-line guard status=approved →
amount/supplier/eta/purchased_at/status=purchased/po_id; audit per line + PO row); ship+delivery stay
per-ticket (partial-across works); **PO status DERIVED** (open→ordered→partially_received→received,
pure helper, not stored); RLS = back-office SELECT (ADR 0026), RPC-only writer (ADR 0038 posture).
**Phased build: spec 115 = data layer** (table+FK+RLS+RPC+helpers+pgTAP+types, schema → operator gate);
**spec 116 = UI** (grid multi-select bundling, create-PO form w/ per-line prices, grouped display, PO
context in the drawer). NOT YET BUILT — schema migration is the riskiest change type (immutable once
merged); building it deliberately. SEAMS: within-ticket partial receipts, PO line-set editing, PO PDF.
Also still open: delete the 7 test PRs (2926–2932) + the /grid-preview page after operator review.

---

## Spec 115 — Purchase orders: data layer (ADR 0044, phase 1) — SHIPPED 2026-06-16

**What:** the PO grouping data layer. Migrations `20260701000000` (audit_action `+purchase_order_create`,
own txn — ADD VALUE can't be used same-txn) + `20260701000100` (table + FK + RLS + RPC) applied to prod
under the operator gate. **No UI** (that's spec 116).

- **`purchase_orders` table:** `po_number` own sequence (mirrors `pr_number`), `supplier_id` FK + `supplier`
  text snapshot (spec-33 pattern), `eta`, `ordered_at`, `notes` CHECK(≤2000), `created_by`, timestamps.
  **NO money column** (§3) — the PO total is the computed SUM of member `purchase_requests.amount`, so per-WP
  material spend (specs 100/103/106) stays exact. RLS: back-office SELECT site-wide (site_admin/PM/procurement/
  super, ADR 0026, eval-once wrapped); **NO INSERT/UPDATE/DELETE policy** — the RPC (function owner) is the
  only writer (ADR 0038). `grant select` to authenticated only; appsheet_writer unaffected.
- **`purchase_requests.purchase_order_id`** nullable FK → `purchase_orders(id)` (§2). RPC-only-writable: the
  column-scoped authenticated UPDATE grant (20260616000400) doesn't name it, so app sessions can't set it
  directly. Indexed (PO → members read). `purchase_orders.supplier_id` also indexed.
- **`create_purchase_order(p_supplier_id uuid, p_eta date, p_lines jsonb)`** SECURITY DEFINER, search_path
  pinned, returns the new PO id (uuid). Back-office gate on the **authenticated session** (spec-68 lesson —
  service-role has no JWT so auth.uid()/current_user_role() would refuse it; grant execute to authenticated,
  revoke from public/anon). Inserts the PO; per line `{request_id, amount}` guards `status='approved'` then
  stamps amount/supplier(snapshot)/eta/purchased_at=now()/status='purchased'/purchase_order_id. **All-or-
  nothing** (one txn — a non-approved line rolls back the whole bundle). Audit: the per-line approved→purchased
  UPDATE fires the **existing** `purchase_requests_audit_appsheet` trigger → one `purchase_request_purchase`
  row per line (mirrors record_purchase, null-actor/principal=authenticated); the RPC writes ONE additional
  `purchase_order_create` row carrying the real actor + po_number/supplier/eta/request_ids.
- **Pure helpers** `src/lib/purchasing/purchase-order.ts` (TDD-first, 10 unit): `derivePurchaseOrderStatus`
  (open→ordered→partially_received→received; on_route counts as ordered; rejected/cancelled EXCLUDED;
  empty roll-up → open) + `purchaseOrderTotal` (sum of non-null line amounts).
- **pgTAP file 49** (+48): catalog/columns/notes-CHECK/RLS posture (1 SELECT policy, no write policy, no
  authenticated INSERT/UPDATE)/member FK; RPC signature (SECURITY DEFINER + search_path + returns uuid +
  authenticated-only execute) + behaviour (bundles approved → purchased/priced/stamped/snapshotted; sums 300;
  PO-create + 2 per-line purchase audit rows; refuses non-approved line / empty set / unknown supplier; atomic
  rollback). Enum pins updated in files 03 + 18 (grep-all-enum-pins lesson).
- **database.types.ts** hand-extended then `db:types` reconciled — content byte-identical (only delta was the
  `purchase_orders` block ordering; Supabase sorts it before `purchase_requests`).

**Gate honored:** built local-green (lint / typecheck / 842 unit / build), AskUserQuestion → "Apply now" →
db:push (migration FIRST), db:types reconcile, db:test 1073/0-fail, THEN commit + push. **Suites:** 842 unit /
1073 pgTAP.

**Acceptance (no UI):** `create_purchase_order` bundles approved tickets into a PO (each line → purchased,
priced, stamped), refuses a non-approved line, is back-office-gated; per-WP spend still reads each line's
amount; pgTAP green. **Next:** spec 116 = the UI (grid multi-select bundling, create-PO form with per-line
prices, grouped display, PO context in the review drawer). Out (later units): within-ticket partial receipts
(split qty), PO line-set editing, PO PDF.

**Still open (test artifacts, delete on operator's "done reviewing"):** the 7 seeded test PRs
(`delete from public.purchase_requests where pr_number between 2926 and 2932;`) + the temporary
`src/app/grid-preview/page.tsx` (spec 113) + its `nav-back-affordance.test.ts` EXCLUDED_ROUTES entry.

---

## Spec 116 — Purchase orders: create-PO UI (ADR 0044, phase 2) — SHIPPED 2026-06-16

**What:** the screen to actually create a multi-ticket PO (spec 115 shipped only the engine). On the
procurement desktop grid, the buyer checks several **approved** (`to_order`) tickets → a sticky
`สร้าง PO (n)` bar → a bottom-sheet form (supplier picker + ETA + per-line price inputs + live total) →
`createPurchaseOrder` action → the `create_purchase_order` RPC bundles them atomically. **No schema**
(pure UI on the spec-115 data layer).

- **Pure validator** `src/lib/purchasing/validate-create-purchase-order.ts` (TDD, 8 unit): ≥1 line, a
  supplier UUID, each amount null-or-positive, no duplicate request ids, and a **required** valid ETA
  (deliberate — a PO commits a delivery date; ad-hoc `record_purchase` stays ETA-optional. Optional-PO-
  ETA is a recorded seam needing the RPC's `p_eta` to gain a SQL default first).
- **Server action** `createPurchaseOrder({ supplierId, eta, lines })` in `src/app/requests/actions.ts`
  — runs on the **authenticated user session** (`getActionUser`, NOT the admin client, because the RPC
  is role-gated on `current_user_role()`); calls `supabase.rpc("create_purchase_order", …)`, maps
  42501/P0001 to Thai, `revalidatePath("/requests")`, returns `{ ok, poId }`.
- **`CreatePurchaseOrderSheet`** (`src/components/features/create-purchase-order-sheet.tsx`, client):
  supplier `<select>`, ETA date, per-line price inputs, live total via `purchaseOrderTotal`. Submit →
  action → on success clears the selection, closes, `router.refresh()` (bundled rows leave `to_order`,
  appear in `in_transit`). Component test (4): renders lines + live total, submits the right payload,
  surfaces errors, rejects a bad price client-side.
- **`procurement-grid.tsx`**: a checkbox on each approved (`to_order`) row + the sticky bundle bar +
  the sheet — **all gated on `canBundle` (suppliers present)**, so the spec-113 preview/smoke (no
  suppliers) stays selection-free and router-free.

**LESSON (the smoke test earned its keep):** `ProcurementGrid` initially mounted `CreatePurchaseOrderSheet`
unconditionally; the sheet's top-level `useRouter()` threw "app router not mounted" in the no-router
smoke test. Gating the mount on `canBundle` fixed it — a component that calls `useRouter` must not be
mounted on a surface that has no router (preview/smoke). All create-PO props are client→client (the
ผู้ขาย server→client function-prop lesson does not bite here).

**Gate:** 860 unit / lint / typecheck / build green. No schema → no operator gate; committed + pushed.
**Acceptance** (procurement can't be preview-verified — preview only renders `/login`): a procurement
user (Pattrawut) on a PC checks 2+ approved tickets → สร้าง PO → supplier + ETA + prices → creates the
PO; tickets become purchased/priced/stamped and leave the to-order band.

**OUT (deferred follow-ups):** grouped PO display (a PO + its members as a group) + PO context in the
review drawer; PO line-set editing; PO PDF; phone multi-select; optional-PO-ETA. Also still queued: the
**documents+photos attachments** unit the operator asked for (Q1 answered = documents + photos; build
after this).

---

## Spec 117 — Create-PO UX round (mockup-approved) — SHIPPED 2026-06-16

**What:** operator said "think hard about the UXUI" on the spec-116 create-PO flow. Since procurement
routes can't be preview-verified (preview only renders `/login`), a hard critique found real defects, a
visualize **mockup** was built, and the operator approved "build the full redesign." Seven UI fixes (no
schema):

1. **Right-side panel, not a bottom sheet** — the form was a `BottomSheet` (phone idiom) on a
   desktop-only feature; switched to `side="right"` (matches the review drawer). 2. **Inline
   เพิ่มผู้ขายใหม่** (createSupplier) — no more dead-end when the supplier isn't listed. 3. **Required-ETA
   `จำเป็น` badge + disabled-submit helper line** (explains why the button is off). 4. **Selected rows
   highlighted** (`bg-action-soft`) on the grid. 5. **Discoverability caption** above the grid
   (procurement). 6. **WP code per line** in the sheet (bundles can span projects). 7. **Success toast**
   (`useToast().success`) on create.

Files: `create-purchase-order-sheet.tsx` (rewritten), `procurement-grid.tsx` (highlight + caption +
`wp_code` into `CreatePoLine`), component test extended (+1 inline-add-supplier case, `createSupplier`
mock, `wp_code` fixtures). **TRAP fixed:** a `จำเป็น` badge inside the ETA `<label>` would change its
accessible name and break `getByLabelText` — moved the badge to a sibling of the label. `useToast` is a
NO-OP outside its provider, so the test needs no toast mock.

**Gate:** unit / lint / typecheck / build green; no schema → no operator gate; committed + pushed.
**Acceptance** = procurement (Pattrawut) on a PC: tick approved tickets (rows highlight) → right-side
สร้าง PO panel → add supplier inline / set required ETA / enter prices → create → success toast.

**METHOD note (reusable):** for an un-preview-verifiable surface, the right move on a "think about UX"
ask is a visualize mockup → operator approval → build (the spec-108 loop), NOT shipping blind UI then
hoping. The mockup is the verification the preview can't give.

---

## Spec 118 — Phone PO creation: the add-to-PO basket — SHIPPED 2026-06-16

**What:** operator "what about on phone?" — specs 116/117 made PO creation desktop-only (grid is `lg:`).
Senior-designer pass (the uxui bundle): the real choice was the phone interaction MODEL; operator picked
the **basket** (browse → add → checkout) over worklist-tick / supplier-first, and approved a detailed
mockup before the build. SHIPPED (no schema).

- **`PhonePoBasket`** (client) renders the `to_order` band on phone as compact cards (item/PR·WP·qty/
  status, tap → detail) each with a **เพิ่มเข้าใบสั่งซื้อ** toggle; added → highlighted + **อยู่ใน
  ใบสั่งซื้อ · แตะเพื่อนำออก**. A **floating basket bar** (`bg-fill`, fixed, `z-30`, `lg:hidden`) shows the
  running count **above the tab bar** (`bottom-[calc(4rem+env(safe-area-inset-bottom))] sm:bottom-4` —
  phone has the 64px+safe tab bar, tablet doesn't) → opens the checkout sheet.
- **Checkout** reuses `CreatePurchaseOrderSheet` at `side="bottom"` (the reason the bottom variant was
  kept when spec 117 moved desktop to `side="right"`) + a new optional `onRemoveLine` (per-line ✕ to
  drop a ticket; empties/closes on the last). Supplier+inline-add, required ETA, prices, total, success
  toast all inherited.
- **Page**: `/requests` phone block — `to_order` band → `PhonePoBasket` when `canBundlePhone`
  (procurement + suppliers loaded); other bands keep `PurchaseRequestCard`; desktop keeps the grid.
  Reuses the serializable `ProcurementGridRecord` the grid builds.

**Test:** `phone-po-basket.test.tsx` (4) — add reveals the bar + count, bar opens the sheet, a line drops
from inside the sheet. **Gate:** unit / lint / typecheck / build green; no schema → no gate; committed +
pushed. **Acceptance** = procurement (Pattrawut) on a **phone** (phone layout can't be preview-verified;
the bar/tab-bar offset is breakpoint-sensitive — operator-on-device).

**LESSON (layout, reusable):** the `lg:hidden` phone block spans BOTH phone (<640, fixed tab bar present)
and tablet (640–1024, no tab bar — HubNav top strip instead). A bar pinned above the tab bar needs a
responsive offset (`bottom-[calc(4rem+safe)] sm:bottom-4`) or it floats with a gap on tablet. PageShell
`app` = `pb-20 sm:pb-0` (phone tab-bar clearance); add a spacer so a fixed bar never covers the last card.

---

## Spec 119 / ADR 0045 — VAT capture on purchases (phase 1) — SHIPPED 2026-06-16

**What:** operator asked about partial delivery + VAT. **Partial delivery = CLOSED** (across-ticket
already works via the spec-115 PO roll-up; within-ticket split-quantity declined). **VAT** — operator:
"user can pick whether the price is inclusive or exclusive"; spend = GROSS. SHIPPED (migration
`20260701000200` applied to prod under the gate; 874 unit / 1075 pgTAP / lint / typecheck / build).

- **Model (ADR 0045):** `amount` is canonically the GROSS (what you pay; spend/budget/PO-total read it
  unchanged). New `purchase_requests.vat_rate numeric(5,2) default 0` (CHECK 0–100); **net/VAT DERIVED**
  (`src/lib/purchasing/vat.ts`, TDD 8 unit: `deriveVatBreakdown` net+VAT sum back to gross;
  `grossFromEntry`; `rateForMode`; `VAT_RATE=7`). The mode (inclusive/exclusive/none) is an entry
  convenience — only gross + rate are stored.
- **Migration:** vat_rate column + the 3 amount-entry RPCs (`record_purchase`, `create_purchase_order`,
  `record_site_purchase`) DROP+CREATE with `+p_vat_rate` (default 0 → existing callers/tests/appsheet
  unaffected; bodies reproduced verbatim + the rate). vat_rate = amount's posture (RPC-write, not in the
  authenticated UPDATE grant). RPC sig pins updated (files 26/33/49, +numeric). pgTAP file 49 +2.
- **UI (this push — PO checkout only):** `CreatePurchaseOrderSheet` gains a VAT mode picker; per-line
  prices resolve to gross via the mode; **live net/VAT/gross breakdown**; `createPurchaseOrder` passes
  `p_vat_rate` (one rate per PO). Sheet test +1 (exclusive → +7%).

**Gate honored:** local-green → "Apply now" → db:push (migration first) → db:types reconcile (content
byte-identical; only the `create_purchase_order` Args line reflowed) → db:test 1075/0-fail → commit+push.

**OUT (additive follow-ups — RPCs already accept the rate, NO further schema):** VAT picker on the
`record_purchase` + `record_site_purchase` forms; a **persistent net/VAT readout** on the request detail
page + the grid/drawer. **OUT (v3 accounting):** withholding tax, tax-invoice (ใบกำกับภาษี) docs, reports.

---

## Spec 120 — Unify purchase recording into PO creation — SHIPPED 2026-06-16

**What:** operator — "replace บันทึกการสั่งซื้อ with the new PO creation." Two purchase paths had diverged
(spec-33 per-ticket `record_purchase` form vs the spec-116/119 PO flow); PO is the better-built one, so
it becomes the single path. SHIPPED (migration `20260701000300` applied to prod under the gate; 874 unit
/ 1076 pgTAP / lint / typecheck / build).

- **Single-ticket = a one-line PO.** On an approved request the inline record form → a **"สร้าง PO"
  button that opens the create-PO sheet pre-seeded with that one ticket** (one tap, no grid hunting; VAT/
  supplier/ETA/price/order_ref all ride along). Detail page: `CreatePoFromRequestButton` (new client; the
  server page passes the serializable line + suppliers). Procurement drawer: the `record` action → a
  button that closes the drawer, seeds the basket with that record, opens the grid's existing sheet (an
  `onCreatePo` callback threaded RecordReviewDrawer → DrawerBody; `suppliers` dropped from that chain).
- **order_ref carried.** Migration DROP+CREATE `create_purchase_order` `+p_order_ref` (≤80, one per PO,
  written onto each member's existing `purchase_requests.order_ref` — NO new column). Sheet gains an
  optional order-ref field; action passes `p_order_ref`. (4th create_purchase_order revision today —
  000100 → +vat 000200 → +order_ref 000300; each DROP+CREATE reproduces the prior body verbatim.)
- **`PurchaseRecordForm` retired from the UI** (both usages gone); the component file + the
  `record_purchase` RPC LEFT in place (AppSheet doesn't call the RPC; removal is a later cleanup).
  `SupplierOption` still lives in `purchase-record-form.tsx` as a type-only import.

**Gate honored:** local-green → "Apply now" → db:push → db:types reconcile (IDENTICAL — hand-extension
exact) → db:test 1076/0 → commit + push. pgTAP file 49: order_ref stored + the sig pins (now
`(uuid,date,jsonb,numeric,text)`). Sheet test: order_ref in the payload.

**SESSION TOTAL (2026-06-16, EIGHT units, 5 prod migrations): 115 PO data layer · ผู้ขาย fix · 116 PO
create · 117 create-PO UX · 118 phone basket · 119/ADR0045 VAT · 120 unify-record-into-PO.** PO is now
THE purchase path (desktop + phone, VAT, order_ref). **Acceptance:** approved request → สร้าง PO
pre-seeded → one-line PO. **OUT (cleanup):** delete `PurchaseRecordForm` + the `record_purchase` RPC.

**Spec 120 review tweak (operator):** the VAT picker (a 3-option dropdown) → the accessible `RadioChip`
segmented control (spec 67) with SHORT labels (ก่อน VAT / รวม VAT แล้ว / ไม่มี VAT — the full phrases
would overflow the narrow sheet; the live net/VAT/gross line carries the precise meaning). **Default
flipped inclusive → exclusive (ก่อน VAT)** — a PO is created from a quotation, and Thai quotes are
usually quoted ex-VAT (net + 7%). Surfacing the mode as visible chips + the breakdown is the guard against
the exclusive-transform mis-entry. UI-only (no schema). Sheet test updated (default-exclusive amounts +
RadioChip selection). REUSABLE: ≤4 fixed mutually-exclusive options that affect MONEY → prefer a visible
RadioChip over a dropdown (the user picks deliberately, sees the effect), but keep labels short or it
overflows.

---

## Spec 121 — PDF support in purchasing attachments (ADR 0046 Layer A) — SHIPPED 2026-06-16

**What:** the deferred documents+photos foundation. Purchasing attachments are image-only today
(`pr-attachments` bucket = jpeg/png/webp/heic, downscaled — spec 34). Layer A makes a **PDF** attachable

- viewable on the **existing** surfaces (invoice uploader + reference stager) — attach a PDF quote/
  invoice to a request. Layers B (PO-level source-doc + side-by-side create-PO surface) and C (AI
  extraction) are separate later units, untouched.

* **kind decision = new `'pdf'`** (over a non-downscale `image` branch): ADR 0046 names `kind image|pdf`;
  viewer dispatches cleanly on kind (iframe vs lightbox); `pra_purpose_kind` auto-blocks a PDF from a
  delivery-confirmation slot; the image-only token trigger skips PDFs; semantic honesty.
* **Migrations (operator-gated):** (1) re-assert `pr-attachments` `allowed_mime_types` += `application/pdf`
  (25 MiB cap stays) + `alter type … add value 'pdf'` (no pdf-literal usage in the same file →
  same-txn-safe). (2) `pra_pdf_shape` CHECK (pdf content row carries `storage_path`, no `url`) — separate
  file because the CHECK _uses_ `'pdf'`.
* **No-downscale upload:** raw PDF bytes (`contentType: application/pdf`) to the canonical
  `.../{att}.pdf` path; metadata-after-upload (spec-24 pattern). PDFs NOT offline-queue-bracketed this
  unit (manual-retry, mirrors invoice uploader — recorded seam; `QueuedUpload.ext` stays `PhotoExt`).
* **Viewer:** `AttachmentPdf` (signed-URL `<iframe>` + open-in-new-tab); detail page groups by kind
  (reference images/PDFs/links; invoice images/PDFs); signed URLs minted for image + pdf rows.

**Money posture unchanged.** Gate honored: lint / typecheck / build / **881 unit** local-green →
AskUserQuestion "Apply now" → db:push (migrations `20260702000000` + `20260702000100` applied to prod) →
db:types reconcile (**byte-identical** to the hand-extension) → db:test **1081/0**. Then commit + push.

**Build notes (reusable):** (1) `buildPrAttachmentStoragePath` widened `PhotoExt` → `AttachmentExt`
(`PhotoExt | "pdf"`) — its existing pin test asserted `pdf` → null; flipped to assert it builds, added a
truly-invalid-ext case (TDD red→green anchor). (2) The detail page's reference grouping used
`kind !== "image"` for links — a pdf would have leaked into the link list (and been dropped, url=null);
fixed to `kind === "link"` + a new `referencePdfs`/`invoicePdfs` split. (3) Signed-URL minting widened
to `image || pdf` rows (pdfs were getting no URL). (4) Server actions derive the stored kind from the
validated ext (`attachmentKindForExt`) — client-passed kind is not trusted; `findLandedAttachment` now
pins the actual kind (image-only check would mis-replay a pdf). (5) `addDeliveryConfirmationPhoto` stays
image-only on purpose (a receipt photo; `pra_purpose_kind` enforces). **Acceptance owed:** procurement/
back-office user attaches a PDF quote/invoice on `/requests/[id]` → uploads un-downscaled + renders in
the iframe viewer; images still work. (Auth-gated route → operator-on-live, not preview-verifiable.)
**Recorded seam:** PDF reference attachments are NOT offline-queue-bracketed (manual-retry, mirrors the
invoice uploader; `QueuedUpload.ext` stays `PhotoExt`). **NEXT:** ADR 0046 Layer B (document-first
create-PO: PO-level source-doc + side-by-side surface) → Layer C (AI extraction, Claude).

---

## Spec 125 — PO source-document attachments (ADR 0046 Layer B, Unit 1) — SHIPPED 2026-06-16

**What:** the quotation/invoice a PO is created from now attaches at the **PO level** (ADR 0046
decision 2). Operator picked the **phased "attach-doc first"** cut: this unit = data layer + a doc picker
in the **existing** create-PO sheet (uploaded when the PO is created) + a viewer on the request detail
page. The full **side-by-side wide doc|form surface** (ADR 0046 decision 4) is the next unit.

- **Decisions** (ADR 0046 left these "to decide at spec time"): grain = a **`purchase_order_attachments`
  table** (mirrors pr_attachments; append-only + tombstone-ready; kind image|pdf; **no `purpose` column**
  v1 — every PO doc is the source doc, YAGNI; **no token side-table** — vestigial AppSheet bridge).
  Storage = a **new private `po-attachments` bucket** (image + application/pdf from day one — the Layer A
  lesson), path `{po_id}/{att}.{ext}` (a PO spans projects → po_id is the scope). Writer = **direct INSERT
  under RLS** (mirror pr_attachments), **content rows only** (no tombstone arm/removal UI v1).
- **Upload-on-submit** (ADR 0046 decision 3, resolves the no-po_id-yet chicken-and-egg): the sheet keeps
  the file client-side; `createPurchaseOrder` returns `poId` → browser uploads to `po-attachments/{poId}/…`
  → `addPurchaseOrderAttachment` records the row. PDFs raw (no spec-34 downscale), images prepared. A
  failed doc upload is **non-fatal** (the PO stands; the doc is optional) — toast warns; no re-attach
  surface until the PO-doc page lands (recorded seam).
- **Viewer:** the PR detail page (`/requests/[id]`) shows the PO's source doc when the ticket has a
  `purchase_order_id` (there's no PO detail page yet) — reuses the Layer A `AttachmentPdf` / `ZoomablePhoto`.

**Money posture unchanged.** Gate honored: lint / typecheck / build / **885 unit** local-green →
AskUserQuestion "Apply now" → db:push (`20260703000000` table+bucket; **`20260703000100` fix-forward**) →
db:types reconcile (content byte-identical; only view-block ordering differed, regen committed) → db:test
**1104/0**.

**KEY LESSON (reusable):** the new RLS policies first shipped with **bare** `current_user_role()` /
`auth.uid()` (I mirrored pr_attachments' migration SOURCE, which predates the rank-3 eval-once hardening —
the LIVE policies were since wrapped). **db:test file 40 (rls-eval-once) caught it** (2 failures) → a
fix-forward migration (`20260703000100`) DROP+CREATEs both policies wrapped in `(select …)`. **Any NEW
public RLS policy must wrap auth calls in `(select …)` from the start** — don't copy a pre-2026-06-25
migration's bare form. **Acceptance owed:** procurement user creates a PO + attaches a PDF/photo quote →
PO created, doc saved; any member ticket's detail page shows the source doc. (Procurement-gated route →
operator-on-live.) **NEXT:** ADR 0046 Layer B Unit 2 (the side-by-side wide create-PO surface) → Layer C
(AI extraction). Seams: PO-doc removal/replace UI; multi-doc + quote/invoice `purpose` split; PO detail page.

---

## Spec 126 — Document-first create-PO surface (ADR 0046 Layer B, Unit 2) — SHIPPED 2026-06-16

**What:** the attached quote/invoice is now a **readable reference while filling the PO** (ADR 0046
decision 4). Spec 125 added the doc picker + upload-on-submit (filename chip only); this makes the doc
preview side-by-side. **Operator decisions** (AskUserQuestion, after a visualize mockup — the right move
for an un-preview-verifiable procurement+lg surface): container = **wide modal** (over a dedicated route —
preserves the in-memory ticket selection from all 3 entry points); flow = **attach-inside-expands**.
**NO schema** (pure UI on Unit 1's table/bucket/action) → no operator gate.

- `BottomSheet` gains **`wide?`** — the RIGHT panel grows `max-w-md → lg:max-w-5xl` (no effect on the
  bottom variant). Create-PO sheet passes `wide={docFile != null}`.
- **Client object-URL preview** (ADR 0046 decision 3 — no upload while filling): PDF via `<iframe>`,
  image via `<img>` on a `blob:` URL (revoked on change/unmount); bytes still upload on submit (spec 125).
- **Split on lg+, toggle on phone:** doc attached → 2-col `lg:grid-cols-[3fr_2fr]` (doc left, form right);
  below `lg` a เอกสาร⇄ฟอร์ม toggle (`hidden lg:block` swap, fresh attach lands on เอกสาร). No doc → the
  plain single-column form + an attach button; the attach affordance (เปิด/เปลี่ยน/นำออก) moves into the
  doc pane once a doc is present. All 3 entry points inherit it (shared sheet; sheet is always `side="right"`).

**Gate:** lint / typecheck / build / **885 unit** green; no schema → no db:push, pgTAP unchanged (1104);
committed + pushed. **Acceptance** (procurement, lg-only, not preview-verifiable → operator-on-live): open
create-PO, attach a PDF/photo → tablet/PC shows doc-left form-right; phone toggles; submit creates + saves.
**METHOD note:** mockup (visualize) → AskUserQuestion (container + flow) → build — the un-preview-verifiable
UI loop (spec 108/117/118). **NEXT:** ADR 0046 Layer C (AI extraction → prefill the verified form, Claude).
Seams unchanged from Unit 1 (PO-doc removal/replace UI, multi-doc + purpose split, PO detail page).

## Spec 122 - feature components grouped into domain folders (2026-06-16)

Status: COMPLETE (2026-06-16). Quality-debt unit from the codebase review (see
`docs/quality-debt-plan-2026-06.md`). Pure refactor: move 64 `.tsx` files out of the flat
`src/components/features/` root into 7 domain subfolders (purchasing 22 · work-packages 8 ·
photos 3 · labor 4 · contacts 4 · chrome 10 · common 13), rewrite every `@/components/features/*`
import (all referencing files use the alias — no relative cross-imports). No ADR (taxonomy
in-spec). Test-first: `tests/unit/feature-components-structure.test.ts` (no loose `.tsx` in root,
only known domains). `tsc` is the no-missed-import proof.

**Done:** 64 `git mv` (renames, history preserved); imports rewritten across 104 files (anchored on
the closing quote so no prefix can partial-match). Two follow-ons the `@/`-anchored rewrite missed,
caught by the suite: 4 literal `readFileSync` path strings in `design-doctrine` /
`wp-schedule-panel-overflow` tests, and a stale path in a `src/lib/labor/types.ts` comment — fixed.
**Gate:** lint clean · typecheck clean · **888 unit green** (128 files) · `pnpm build` green. Diff
audit: every `src/` change is an import-path edit, nothing else; 64 renames stage content-identical.
No DB/schema → no db:push, pgTAP untouched. **NOT committed** (operator merges on laptop). Staging
note: exclude the foreign uncommitted `docs/sdd-2026-06.md` + untracked `uxui-*.md` /
`app-workflows-and-roles.md` (other sessions' work) from this unit's commit. Open question: the
index lists spec 93 with no `93-*.md` file (pre-existing, not this unit).

## Spec 123 - single source for generated DB types, app ↔ worker (2026-06-16)

Status: COMPLETE (2026-06-16). Implements ADR 0047 (Proposed → operator accepts at
merge). `database.types.ts` exists twice; worker copy badly stale (app 2281 lines vs worker 705 —
predates `clients` and everything after). Worker is NOT a pnpm-workspace member (own lockfile,
Railway root=/worker) so it cannot import from `../src`; keep the vendored copy but (a) regeneration
writes both files, (b) a drift-guard test fails red on divergence. Test-first:
`tests/unit/db-types-sync.test.ts` (worker copy byte-identical to app, EOL-normalized) — red now
given the drift. Live `pnpm db:types` regen is operator-gated (needs `supabase login`); the resync
(byte copy app→worker) + guard prove the mechanism without DB.

**Done:** `scripts/gen-db-types.ts` (spawns `supabase gen types`, writes both files; `db:types`
script repointed to `tsx scripts/gen-db-types.ts`); worker copy resynced app→worker (705→2281 lines,
now identical). **Gate:** drift test green · lint clean · typecheck app + **worker** clean (worker
code compiles against the full types) · **889 unit green** (129 files). No build needed — the app's
`src/lib/db/database.types.ts` is unchanged; only the worker copy + new script + test changed, all
covered by typecheck. **Operator-gated (not run here):** `pnpm db:types` against the linked DB to
confirm the dual-write matches the live schema (needs `supabase login`); ADR 0047 Proposed→Accepted.
**NOT committed** (laptop merge). Same staging caution as spec 122 re: foreign `docs/sdd-2026-06.md`

- untracked `uxui-*.md` / `app-workflows-and-roles.md`.

## Spec 124 - CI worker job + codified test-tier policy (2026-06-16)

Status: COMPLETE (2026-06-16). Implements ADR 0048. CI ran only app lint/typecheck/test;
the `worker/` package (own lockfile) was never built/tested in CI. Add a secret-free `worker` job
(install --frozen-lockfile → typecheck → test in `worker/`); the spec-123 drift test rides the
existing app `pnpm test` job (no new wiring). `db:test`/`test:e2e` stay local Tier-B gates; a manual
`workflow_dispatch` `db-test` job is added but inert (guarded on a repo variable + secret the
operator must provision — Tier C). CI config = no app code; TDD obligation carried by the worker's
own suite + the drift guard. Validated locally: `cd worker && pnpm install --frozen-lockfile &&
pnpm typecheck && pnpm test` → 6 green.

**Done:** `.github/workflows/ci.yml` gains a `worker` job (checkout → pnpm → node22 →
install/typecheck/test in `worker/`, cache keyed on `worker/pnpm-lock.yaml`) + a `workflow_dispatch`
trigger + an inert `db-test` job (`if: workflow_dispatch && vars.ENABLE_DB_TEST == 'true'` — skipped
until the operator opts in + provisions `SUPABASE_ACCESS_TOKEN`). **Gate:** worker sequence green
locally (6 tests); YAML parses (js-yaml exit 0); app suite/typecheck unaffected (only `ci.yml` +
docs changed — no app code, no rerun needed; 889 from spec 123 stands). **Operator-gated:** flip ADR
0048 Proposed→Accepted; to activate Tier C, add the `SUPABASE_ACCESS_TOKEN` secret + set repo
variable `ENABLE_DB_TEST=true` (confirm `supabase link` needs no interactive input in CI). Same
foreign-file staging caution as specs 122/123.

## Quality-debt batch 122-124 — committed (2026-06-16)

"Proceed in my stead" wrap-up. ADRs 0047 + 0048 flipped Proposed→Accepted. Ran `pnpm db:types`
against the LIVE linked DB (CLI still authed) — validated `gen-db-types.ts` end-to-end AND revealed
the committed app types were ~52 lines stale vs live (a migration was pushed without regenerating);
synced both copies to live (raw 2333 lines, identical). All three units committed to branch
`quality-debt-122-124` (one atomic commit; foreign `sdd-2026-06.md` + untracked `uxui-*.md` /
`app-workflows-and-roles.md` excluded). **NOT pushed** — push + PR are laptop-only (CLAUDE.md).

**Gotcha fixed (important):** the husky/lint-staged pre-commit ran prettier on the app types copy
(not prettier-ignored) but NOT the worker copy (`worker/` is in `.prettierignore`) → the two diverged
INSIDE the first commit and the drift guard failed. Fix: add `src/lib/db/database.types.ts` to BOTH
`.prettierignore` and the eslint `globalIgnores` (generated files must never be hand-formatted, else
every future `db:types`+commit re-breaks the guard). Re-synced raw output to both, amended.

**Final gate (committed state):** drift green · lint clean · typecheck app + worker clean · 889 unit
green (129 files) · `pnpm build` green. **Operator remaining:** `git push` branch + open PR; (Tier C
CI) add `SUPABASE_ACCESS_TOKEN` secret + repo var `ENABLE_DB_TEST=true`.

## Spec 127 U1 - DC payment recording: data layer + reconciliation helper (2026-06-16)

Status: COMPLETE — 2026-06-16. Migrations applied to prod (`db:push` operator-confirmed); `db:types` regenerated + reconciled (typecheck green against live schema, worker copy synced); pgTAP **51 files / 1125 asserts / 0 failures** (file 35 plan corrected 20→21 mid-run). Closes the seam spec 69 recorded ("mark this period paid"). Operator decision (2026-06-16): target the per-day (รายวัน) model; lump-sum (เหมา) is a separate track. Full design in spec 127; U2 = payroll UI, U3 = void/correct + reconciliation depth (seams). **DB:** migration A `dc_payment_recorded` audit_action value (own txn, ADR-0008 split); migration B `dc_payment_method` enum (bank_transfer|cash|cheque) + `dc_payments` ledger (append-only, money-isolated like wp_labor_costs: zero authenticated grant, RLS on, no policies; BEFORE UPDATE/DELETE trigger blocks mutation even for service-role; supersede columns ship now, void/correct RPC deferred to U3) + `record_dc_payment` RPC (SECURITY DEFINER, pm/super only — SA refused as money; contractor probe; period/amount guards; advisory lock per (contractor,period); one-current-payment-per-exact-period guard; **recomputes** computed_amount/days from current DC labor logs in-window — filter matches aggregatePayroll; one dc_payment_recorded audit row). **App:** pure `src/lib/labor/payments.ts` `annotatePayrollPayments` (current-payment anti-join, exact-period match, drift = live owed ≠ recorded snapshot, paid/unpaid counts + outstanding) — TDD, 11 unit tests first. **pgTAP** file 35 (21 asserts: catalog/RLS, zero-grant read+write refusal, append-only UPDATE/DELETE→P0001, RPC role gates sa+visitor refused, happy-path recompute excludes superseded/tombstone/own/out-of-window, audit row+payload, dup + unknown-contractor guards). Enum pins updated files 03 + 18 (file 19 has no audit_action pin — spec 68's note was stale; corrected). database.types hand-extended (dc_payments Row/Insert/Update + record_dc_payment Fn + dc_payment_method enum + audit union/Constants), worker copy synced (spec 123 guard). Verification: lint clean · typecheck clean · 900 unit green · build green. Open question: paying the payroll "unassigned" (null contractor_id_snapshot) group — resolve worker→contractor first (seam).

## Spec 127 U2 - DC payment recording: payroll UI (2026-06-16, same session, operator override of one-unit-per-session)

Status: COMPLETE — 2026-06-16. No schema change (pure UI + server action over the U1 RPC), no prod gate. **App:** `validateDcPayment` (pure, Thai; contractor uuid, period order, paid date round-trip — rejects Feb-31 day-overflow that Date.parse rolls over, amount 0..<1e10, method enum, ref≤120/note≤500) + `DC_PAYMENT_METHODS`/`DC_PAYMENT_METHOD_LABELS` (โอนเงิน|เงินสด|เช็ค) in payments.ts — TDD, 9 tests first. `recordDcPayment` server action (requireRole pm/super relay, authenticated `supabase.rpc('record_dc_payment')`, RPC errors → Thai: duplicate/“บันทึกไว้แล้ว”, not-found). `fetch-payments.ts`: `fetchPeriodPayments` (dc_payments for exact period, admin client) + `fetchContractorBanks` (batch contact_bank `.in()`, admin) — both money, PM-gated callers only. **UI:** `/payroll` annotates groups via `annotatePayrollPayments`; summary adds จ่ายแล้ว X / ค้างจ่าย Y ราย + ยอดค้าง; per group → green “จ่ายแล้ว ฿X · date · method” (+ amber drift note reusing border-attn/bg-attn-soft when live≠recorded), or `RecordPaymentSheet` (BottomSheet: prefilled amount, paid date=today Bangkok, method RadioChips, ref, note, **bank shown as transfer target** — closes B3 money-scatter gap), or muted “ระบุผู้รับเหมาก่อน” for the unassigned group. Money posture: page already requireRole(PM_ROLES); client-component props (computed amount, bank) ride the PM-only RSC payload, never an SA surface — same trust boundary as the WP-review RefreezeButton. Verification: lint clean · typecheck clean · **909 unit green (131 files)** · build green. Browser preview skipped — page is auth+DB-gated (login redirect locally), acceptance = operator phone pass (same as specs 68/69). U3 seams unchanged (void/correct via supersede, partial-period reconciliation, “paid” CSV column, audit export).

## Spec 129 U1 - PEAK accounting integration: sync infrastructure (2026-06-16)

Status: COMPLETE — 2026-06-16. Migration applied to prod (`db:push` operator-confirmed); `db:types` reconciled (typecheck green vs live schema, worker copy synced); pgTAP **52 files / 1141 asserts / 0 failures** (file 36 added). lint clean · 909 unit green · build green. Operator (2026-06-16): scope = both purchases→PEAK expenses + DC payments→PEAK expenses (contacts foundation); PEAK access = none yet, requesting the free 3-month UAT sandbox → build credential-free parts now. Full design spec 129; outbound only (prc-ops source of truth → PEAK accounting). **PEAK API reality (researched):** REST/JSON, docs developers.peakaccount.com (llms.txt+OpenAPI), auth `POST /api/v1/clienttoken` from API Key+Secret Key, free 3-mo UAT; endpoints `/contacts` (+ tax-id autofill), `/expenses` (+ -void), `/billingnotes`, `/invoices`/`/quotations`/`/receipts`/`/creditnotes`, `/products`/`/services`, `/paymentmethods`, `/dailyjournals`; rate limits + webhooks. **U1 (credential-free):** migration `20260705000000_create_peak_sync` — enums peak_entity_type/peak_sync_operation/peak_sync_status/peak_doc_type; `peak_sync_outbox` (queue, deliberately mutable, payload jsonb so PEAK-shape-agnostic) + `peak_sync_links` (idempotency map, UNIQUE (source_table,source_id,peak_doc_type)) — both zero user access (RLS on, no policies, revoke anon/authenticated), worker-drains-via-service-role, mirrors notification_outbox (ADR 0037, no new audit_action); `enqueue_peak_sync` SECURITY DEFINER RPC (staff sa/pm/super gate; idempotent — returns existing live job for (source,operation) instead of duplicating). pgTAP file 36 (16 asserts: catalog, enum labels, RLS, zero-policy, links UNIQUE, authenticated read refusal ×2, enqueue visitor-refused + sa happy + idempotent-no-dup + pending start). database.types hand-extended (2 tables + enqueue_peak_sync Fn + 4 enums + Constants), worker copy synced. **Units ahead:** U2 pure transforms (contractor/supplier→/contacts, PO/dc_payment→/expenses) + COA/WHT mapping (needs accountant input + fetch PEAK payload schemas); U3 worker PEAK client+drainer (needs UAT creds); U4 capture triggers + sync-status admin UI. Blockers (downstream): UAT creds, COA/WHT mapping, PEAK payload field schemas.

## Spec 130 U1 - DC self-service portal: external identity + binding (2026-06-16)

Status: COMPLETE — 2026-06-16. Migrations applied to prod (`db:push` operator-confirmed); pgTAP **53 files / 1162 asserts / 0 failures**; lint clean · 910 unit green · build green · types reconciled. Two prod defects caught by pgTAP + fixed-forward in `20260706000200`: (1) `gen_random_bytes` (pgcrypto) unavailable → token now via `gen_random_uuid()`; (2) the two new SELECT policies called `current_user_role()`/`auth.uid()` bare → wrapped `(select …)` per the rls-eval-once doctrine (file 40). ADR 0051 (Accepted: external partner access model — row-level RLS tier; same-app hard-bounded /portal segment + LINE auth, operator-confirmed). Operator (2026-06-16): full DC portal, DC first, clients later. Spec 130; this unit = the identity foundation only (no portal UI, no row-level RLS yet — that's U2). **App:** roleHome `contractor → /portal` (test-first); `contractor` added to user_role union + Constants + USER_ROLE_LABEL ("ผู้รับเหมา (DC)"). **DB:** migration A `20260706000000` `contractor` role enum value (own txn, ADR-0008 split); migration B `20260706000100` — `contractor_users` (user_id PK → one binding per user, contractor_id FK; RLS: staff-or-self select, RPC-only writes) + `contractor_invites` (single-use expiring token, PM-issued; RLS staff select); `current_user_contractor_id()` SECURITY DEFINER helper (the row-level-RLS primitive for U2, contractor_id axis ⊥ ADR-0013 project axis; reads contractor_users as definer → no recursion); `create_contractor_invite` RPC (pm/super gate, 48-hex token, 14-day expiry); `claim_contractor_invite` RPC (the ONLY sanctioned role→contractor writer: visitor-only gate protects staff, one-binding-per-user no-rebind, single-use + unexpired token, writes binding + flips role + marks invite + role_change audit). pgTAP file 37 (21 asserts incl. exhaustive claim guards: invalid/expired/already-used/staff-can't-claim/bound-can't-rebind, helper NULL→resolves, role flip, audit). user_role pin updated file 01 (ten→eleven). types hand-extended (2 tables + 3 Fns + enum), worker synced. U2 = row-level RLS dual-policies + scoped money grants (exhaustive cross-party pgTAP); U3 portal read surfaces + /portal middleware boundary; U4 self-edit + PM approval queue. Out of v1: DC labor self-capture, client portal (reuses boundary). Lesson: `gen_random_bytes` is not available on the linked DB (pgcrypto not in path) — use `gen_random_uuid()` for tokens; new RLS policies must wrap role/uid calls in `(select …)` (file-40 eval-once guard).

## Spec 130 U2 - DC portal: row-level RLS + scoped money read (2026-06-16)

Status: COMPLETE — 2026-06-16. Migration applied to prod (`db:push` operator-confirmed); pgTAP **54 files / 1181 asserts / 0 failures**; lint clean · 910 unit green · build green · types reconciled. (pgTAP caught two test-only fixes: file-38 plan 20→19 miscount; file-24 contractors `policies_are` pin updated to include the new external read policy — migration logic was correct first time, isolation asserts all passed.) The isolation core. Migration `20260707000000_contractor_portal_rls`. **Dual-policy** (additive permissive SELECT scoped to `(select current_user_contractor_id())`, eval-once-wrapped) on `contractors` (own row), `workers` (own crew), `labor_logs` (own DC days; `worker_type_snapshot='dc'`). Internal role-level policies untouched (helper is NULL for staff → external policy adds zero rows). **Money posture preserved:** contractors/workers/labor_logs keep money hidden by the existing COLUMN grants (day_rate / day_rate_snapshot have no authenticated grant — a DC reading own rows still can't read those columns). `dc_payments` stays FULLY zero-grant (file 35 intact); a DC reads their own payments + amounts via `get_my_dc_payments()` SECURITY DEFINER reader (hard contractor filter → internal/NULL-contractor sessions get zero rows; current-state anti-join). PM payroll/cost surfaces keep their admin-client reads — untouched. pgTAP file 38 (20 asserts, exhaustive cross-party: uA sees only A's contractor/crew/days/payment; day_rate(\_snapshot) → 42501 even for DC; raw dc_payments → 42501; uB never sees A; site_admin still sees all + zero contractor payments). types hand-extended (get_my_dc_payments Fn), worker synced. U3 = /portal read surfaces + middleware boundary; U4 = self-edit (bank/tax/docs) + PM approval staging (+ contact_bank/docs row scope). Out: DC labor self-capture, client portal.

## Spec 130 U3 - DC portal: /portal surfaces + boundary (2026-06-16)

Status: COMPLETE — 2026-06-16. **No schema change** (UI + a server action over the U1/U2 DB), no prod gate. **Boundary = per-page `requireRole`, not new middleware** — the app has no central middleware (the `proxy.ts` in require-role's comment is "when it ships", never shipped); `requireRole` already routes the not-allowed branch through `roleHome`, so `requireRole(["contractor"])` on /portal bounces staff to their home AND internal pages' existing `requireRole` bounces a contractor to /portal. ADR 0051 §7 satisfied by the established mechanism; a central defense-in-depth guard is a recorded seam. **Surfaces:** `/portal` landing (own profile/crew/payment-history) — reads via the **RLS-respecting server client, never admin** (ADR 0051 §5), so the U2 row-level policies are the enforcement; amounts via `get_my_dc_payments()`; rate columns never selected. `/portal/claim?token=` — visitor-reachable (NOT requireRole-contractor, else a fresh signup bounces to /coming-soon), gated on signed-in, already-bound → /portal; `ClaimButton` (client) → `claimContractorInvite` action → `claim_contractor_invite` RPC via the RLS session. `/portal/loading.tsx` parity. Pure `claimErrorToThai` (RPC msg → Thai, in its own module — a `use server` file may only export async fns; the build caught the sync export) TDD, 2 tests. Two architecture-guard tests updated for the new surface: feature-components-structure (allow `portal/` domain folder), nav-back-affordance (portal=NON_DETAIL, portal/claim=EXCLUDED). Verification: typecheck · lint · 912 unit · build all green. Browser preview skipped — /portal is auth+contractor-binding-gated (redirects to /login locally), acceptance = operator phone pass (claim a real invite, see only own data). U4 next: self-edit (bank/tax/docs) → pending → PM approval queue + contact_bank/docs row-scope.

## Spec 130 U4 - DC portal: bank-change request + PM approval (anti-fraud) (2026-06-16)

Status: COMPLETE — 2026-06-16. Migrations applied to prod (`db:push` operator-confirmed); pgTAP **55 files / 1200 asserts / 0 failures**; lint clean · 917 unit green · build green · types reconciled. (pgTAP caught a prod fn bug fixed-forward in `20260708000100`: `set status = case when … then 'approved' else 'rejected' end` yields TEXT → 42804; cast the CASE to `::contractor_change_status`. Lesson: a CASE assigning an enum column needs an explicit cast.) The anti-fraud gate (ADR 0051 §6). Scoped to **bank** (the actual fraud vector; profile self-edit = seam). Migration `20260708000000_contractor_bank_change`: enum `contractor_change_status` (pending|approved|rejected); `contractor_bank_change_requests` (proposed bank cols + status + requested_by/decided_by/decided_at; the row IS the audit trail — mirrors set_contact_bank which writes no audit_log either); RLS grant-select + two read policies (own contractor via current_user_contractor_id; pm/super) eval-once-wrapped → site_admin matches neither = 0 rows (money hidden); writes RPC-only. `submit_contractor_bank_change` (contractor-only, own, one-pending-at-a-time) + `decide_contractor_bank_change` (pm/super; **approve upserts the live contact_bank** via the set_contact_bank contractor branch, reject discards; refuses re-decide). pgTAP file 39 (19 asserts: submit own/dup/non-contractor-refused; RLS uA-sees-own / SA-0 / pm-sees-queue; decide SA-refused / pm-approve-applies-to-contact_bank / status+decided_by / re-decide-refused / reject-doesn't-apply). **App:** pure `validateBankChange` (TDD, 4 tests); `submitBankChange` + `decideBankChange` actions (portal/actions.ts, both async — no use-server sync-export trap); `BankChangeForm` (portal: form, or "rออนุมัติ" notice while pending) wired on /portal; `BankChangeDecision` (approve/reject) + a pending-requests block on the existing `/contacts/contractors/[id]` PM page (admin-read, behind requireRole). types hand-extended (table + enum + 2 RPCs). Seams: profile-field self-edit, contact-docs upload + storage RLS, a dedicated PM approval queue (today the pending block lives on the contact detail page).

## Spec 131 U1 - DC onboarding packet: data layer (2026-06-16)

Status: COMPLETE — 2026-06-16. Migrations applied to prod; pgTAP **56 files / 1215 asserts / 0 failures**; lint clean · 925 unit green · build green · types reconciled. (pgTAP caught a real security bug, fixed-forward in `20260709000200`: the consent RPCs' self-check `v_is_self := current_user_contractor_id() = p_contractor` is NULL for an unbound caller, so `if not (NULL or false)` = `if NULL` never fired → an unbound visitor BYPASSED the gate and could record/revoke any contractor's consent. Fix: `coalesce(… = …, false)`. **Lesson: a `helper() = x` self-check needs coalesce-to-false whenever the helper can return NULL — 3-valued logic silently opens the gate.** Audited the session's other RPCs: submit_contractor_bank_change + get_my_dc_payments already null-guard explicitly; only the consent pair had it.) Defines what we collect from a DC (operator: DCs are individuals — ID, background-check consent, bank+book, phone, emergency contact; "think what might happen"; differ by type). Full design spec 131. Also recorded the LINE-OA decision (ADR 0051 addendum): one OA now (staff+DC, per-user menus, audience-gated notifications), client OA later. **Migration A** `20260709000000_contact_doc_types`: ALTER contact_doc_purpose += consent, house_registration, insurance, company_cert, vat_cert, contract (own txn; no pgTAP pin on this enum). **Migration B** `20260709000100_contractor_consents`: contractors += emergency_contact_name/relation/phone + date_of_birth (PII not money — ride contractors grant/RLS incl. spec-130 own-row read; added to staff column write-grants); `contractor_consent_kind` enum (pdpa_data|background_check); `contractor_consents` table (dated, REVOCABLE — PDPA; recorded_by, document_id→signed doc, revoked_at) RLS own-contractor + staff read, RPC-only writes; `record_contractor_consent` (self-for-own OR staff) + `revoke_contractor_consent` (self-for-own OR pm/super) SECURITY DEFINER. **Consent is a first-class record, not a checkbox (PDPA spine).** pgTAP file 51 (15 asserts: catalog/columns/new doc-type cast; record gates self/staff/refused-other; read own/staff/visitor-0; revoke own + revoked_at set + unrelated-party-refused + denied-revoke-intact). **App:** pure `contractorPacketStatus` + `dcTypeOfSubtype` + required-by-type constants (TDD, 8 tests) — completeness derived, not stored; individual checklist (ID/phone/emergency/bank/bankbook/PDPA+bg-consent) vs company (+reg cert/ภพ.20); insurance/house-reg available but NOT required. **No TS hand-extend** this unit — nothing in TS consumes the new schema yet (helper is self-contained, UI is U2); db:types regenerates post-push, sync guard stays green. U2 = PM + portal UI (emergency-contact + consent capture + doc upload w/ external-write storage RLS + the completeness checklist). Seams: background-check PROVIDER (manual/store-only now), doc expiry reminders.

## Spec 131 U2 - DC onboarding: PM consent management + completeness (2026-06-16)

Status: COMPLETE — 2026-06-16. **No schema change** (UI + actions over U1's RPCs/helper), no prod gate. lint clean · typecheck clean · unit green · build green. Scoped to the **PM-side** packet surface (the genuinely-new, U1-consuming capability); portal self-service + document upload (external-write storage RLS) + emergency-contact ENTRY form = **U2b** (separate, storage-RLS deserves its own care — not shipped as dead code). **App:** `recordContractorConsent` + `revokeContractorConsent` actions (contacts/actions.ts, pmSession gate → the U1 RPCs on the authenticated session); `ContactConsentBlock` (per-kind status + record/revoke, PDPA labels) on the contractor contact page; a **completeness card** computing `contractorPacketStatus` from docs (getContactDocuments id/bankbook) + bank (getContactBank) + active consents + phone + emergency-contact presence (company_cert/vat_cert = false → only under-reports a company DC, individuals are the norm); emergency-contact + DOB added to the detail LABELS (display). Honest gap: the checklist flags "ขาด: ผู้ติดต่อฉุกเฉิน" until U2b adds the entry form — accurate (not yet collectable), motivates U2b. Verified-by-checklist (page/action wiring; pure helper carried its tests in U1). **U2b:** emergency-contact entry (updateContractorRecord fields + list-edit form), portal self-edit (own-row UPDATE policy) + consent capture + **doc upload w/ external-write storage RLS scoped to own contractor**, company-doc presence in completeness.

## Spec 131 U2b - DC portal self-service: emergency contact + consent capture (2026-06-16)

Status: COMPLETE — 2026-06-16. Migration applied to prod; db:types reconciled; typecheck clean · db-types-sync green; pgTAP **57 files / 1221 asserts / 0 failures** (file 52 = 6/6). The DC self-completes the no-storage parts of their file on /portal. **Document upload + external-write storage RLS = U2c** (the hard, security-sensitive piece — given its own focused pass, not crammed at fatigue). **Migration** `20260710000000_update_own_emergency_contact`: a SECURITY DEFINER RPC writing ONLY the 4 emergency/DOB columns for `current_user_contractor_id()` — **deliberately an RPC, not a broad own-row UPDATE policy** (RLS gates rows, grants gate columns; a blanket policy + the existing broad contractors column-grant would let a DC change their own status/tax_id — the column-scope-via-RPC closes that). pgTAP file 52 (6 asserts: own-edit applies, DOB set, other contractor untouched, unbound-visitor + staff-without-binding both 42501). **App:** pure `validateEmergencyContact` (TDD, 5 tests); `updateOwnEmergencyContact` + `recordOwnConsent` portal actions (recordOwnConsent passes the portal-read contractor id — safe, the RPC self-validates so a forged id 42501s); `PortalSelfEdit` (emergency form prefilled + consent capture w/ PDPA notice + per-kind status) on /portal; portal profile read widened (+id/emergency/dob) + own-consents read (RLS). types hand-extend (update_own_emergency_contact Fn; record_contractor_consent already present from U1 regen). U2c remains: DC doc upload + storage RLS; company-doc presence; PM-side emergency-entry form (DC self-edit covers entry now). Seam: PDPA revoke from the portal (today record-only on portal; revoke via PM).

## Spec 131 U2c - DC document upload + external-write storage RLS (2026-06-16)

Status: COMPLETE — 2026-06-16. Migration applied to prod; db:types reconciled; typecheck · lint · 934 unit · build all green; pgTAP **58 files / 1239 asserts / 0 failures** (new file 53 = 18, file 48 posture fix). **The last DC self-service piece and the most security-sensitive surface in the feature** — a bound DC uploads + reads their OWN onboarding documents from /portal, scoped so they can ONLY touch their own contractor's path. Documents apply directly (evidence, not money — the payout bank stays staged+approved, spec 130 U4); no approval gate on the file. **Migration** `20260711000000_portal_contact_docs`: (1) two `storage.objects` policies on the contact-docs bucket for the external tier — authenticated INSERT + SELECT WHERE `(storage.foldername(name))[2] = (select current_user_contractor_id()::text)` and `[1]='contractor'` (ADDITIVE to the spec-97 PM upload policy; NULL-contractor staff/unbound matches neither → internal posture untouched; helper wrapped `(select …)` for eval-once; `objects.name` qualified for the name-capture hazard); (2) `contact_attachments` += `grant select` to authenticated + own-contractor SELECT policy (was zero-grant — internal staff still read via the admin client; INSERT stays RPC-only); (3) `add_contact_document` widened with a `coalesce(v_self is not null and p_contractor_id=v_self and supplier/sp null, false)` own-doc branch (staff path byte-identical; the 3-valued-logic trap closed — [[rls-self-check-coalesce]]); (4) `my_contact_bank_present()` boolean reader (presence only, no account number — the get_my_dc_payments precedent) so the portal checklist can reuse contractorPacketStatus without granting the zero-grant contact_bank to the DC. **App:** pure `document-types.ts` (PORTAL_DOC_PURPOSES = id_card/bank_book/consent/house_registration/insurance + Thai labels + guard — company_cert/vat_cert are PM-collected, NOT DC-uploadable; 6 unit tests); `addOwnContactDocument` action (derives the contractor id SERVER-SIDE via current_user_contractor_id rpc — never trusts the client — and REBUILDS the path); `getOwnContractorDocuments` (RLS-session read + RLS-session createSignedUrls — NEVER the admin client, ADR 0051 §5); `PortalDocuments` client uploader (mirrors the PM ContactDocumentsBlock machine on the browser RLS client); /portal renders the uploader + the completeness checklist (reuses contractorPacketStatus, own docs/consents/bank-presence). PM completeness card: `getContactDocuments` now reports company_cert/vat_cert PRESENCE → wired into the company-DC packet (was hardcoded false). **Verification — cross-party DENIAL proven at the SQL/policy level** (pgTAP file 53: real storage.objects rows — A cannot upload/read/record B's; unbound visitor denied everywhere; contact_attachments own-contractor scoping). **The positive upload path is an OPERATOR phone smoke test** — the pgTAP runner has no Storage API (spec 23), so the end-to-end "a real DC claims an invite, uploads their ID card, confirms it lands, confirms they cannot reach another contractor's docs" is NOT claimed by the automated suite and awaits the operator. Seams: PM-side upload UI for company_cert/vat_cert (presence wired, no PM uploader yet — DC offers the five individual docs); PDPA revoke from the portal (still PM-only).

## Spec 131 U3 - seam closeout: PM company-doc uploader + portal PDPA revoke (2026-06-16)

Status: COMPLETE — 2026-06-16. **App-only — NO migration / NO prod gate** (the storage PM-INSERT policy never gated on purpose, add_contact_document accepts the full enum, and revoke_contractor_consent already permits self-revoke — all three capabilities existed; this unit only surfaces them). typecheck · lint · **937 unit** (+3) · build all green. Closes the two seams U2c left. **Seam A (PM company papers):** a company DC's contact page now lets the PM upload หนังสือรับรองบริษัท (company_cert) + ภ.พ.20 (vat_cert) alongside ID card / bank book. `CONTRACTOR_DOC_PURPOSES` superset + `isContractorDocPurpose` guard (TDD — id_card/bank_book/company_cert/vat_cert; suppliers + service providers keep the base set); `addContactDocument` branches purpose validation by kind (contractor → superset); `getContactDocuments` now signs company_cert/vat_cert URLs (was U2c presence-bool → now string|null); `ContactDocumentsBlock` renders the two extra rows only when `showCompanyDocs` (contractor && subtype dc_company — individuals/suppliers unchanged, the upload test pins both); the completeness packet reads `!= null`. **Seam B (portal PDPA withdraw):** `revokeOwnConsent` portal action → revoke_contractor_consent (self-validated, sets revoked_at, no deletion); portal consent read += id; `PortalSelfEdit` ConsentCard gains a ยกเลิก withdraw control next to each active ✓ (the checklist's consent item reopens on withdraw). Verified-by-checklist + component tests (isContractorDocPurpose guard, the company-doc-rows render test); auth-gated role-specific pages so no preview exercise (no LINE session/role/data in the dev server). **DC onboarding packet (spec 131) is now feature-complete.** Remaining cross-feature seams unchanged: dedicated PM approval queue; client portal (project_id axis). Standing: U2c operator phone smoke test of the upload path still pending.

## Spec 132 U1 - DC portal profile self-edit: contactability (2026-06-16)

Status: COMPLETE — 2026-06-16. Migration applied to prod; db:types reconciled; typecheck · lint · **943 unit** (+6) · build all green; pgTAP **59 files / 1250 asserts / 0 failures** (new file 54 = 11). New spec 132 (DC portal profile self-edit, **cashout-scoped** — a DC may self-edit only what's needed to stay reachable/payable; money + identity stay controlled). Also added the missing spec-131 + spec-132 rows to the feature-spec index README. **Decision (operator):** `tax_id` stays **PM-only, entered from the uploaded ID card** (U2c) — NOT DC-self-edit, NOT staged; PM verification against the document beats DC self-assertion and avoids a staging machine for one identity/tax field (feeds WHT + PEAK). **U1 scope:** contactability direct self-edit — phone/email/contact_person/mailing_address. **Migration** `20260712000000_update_own_contractor_profile`: a SECURITY DEFINER RPC writing ONLY those four columns for `current_user_contractor_id()` (42501 if unbound) — **column scope by construction, not a broad own-row UPDATE policy** (the spec-131-U2b reasoning: RLS gates rows, grants gate columns; a blanket policy + the broad contractors column-grant would let a DC change their own status/name/tax_id). Direct, no staging (contactability is not money). pgTAP file 54 proves: own-edit applies (4 cols), **name/status/tax_id untouched** (a blacklisted A stays blacklisted), another contractor untouched, unbound-visitor + staff-without-binding both 42501. **App:** pure `validateContractorProfile` (TDD, 7 tests — lengths mirror the contractors CHECKs, optional/blank-clears, basic email shape); `updateOwnContactInfo` portal action; `PortalContactInfo` edit form on /portal (tax_id + specialty stay read-only display); types hand-extend (update_own_contractor_profile Fn, both app + worker). Verified-by-checklist for the form (pure validator carries its tests); auth-gated page → no preview. **Cashout-portal field doctrine now codified in spec 132** (bank=staged, tax_id=PM-from-ID-card, contactability=direct, name/status/subtype=locked). Open seam (deferred, not decided): whether emergency-contact / insurance / house-registration belong on a strictly-cashout portal (worker-safety/HR, not payment) — kept as-is for now.

## Spec 130 U5 - PM portal-invite issuance UI (2026-06-17)

Status: COMPLETE — 2026-06-17. **App-only — NO migration / NO prod gate** (the create_contractor_invite RPC shipped in 130 U1; this unit only surfaces it). typecheck · lint · **946 unit** (+3) · build all green. **Closes the gap that blocked the U2c smoke test AND real DC onboarding:** the claim side (/portal/claim?token=) shipped in 130 U3, but the ISSUE side had no UI — create_contractor_invite was called nowhere in the app, so a PM had no way to mint the link a DC needs. **App:** `createContractorInvite` action (contacts/actions.ts, pmSession gate → the U1 RPC; returns the token); pure `buildClaimUrl(origin, token)` (TDD, 3 tests — the /portal/claim?token= shape in one place, trailing-slash + url-encode safe); `ContractorInviteBlock` on the contractor contact page — "สร้างลิงก์เชิญ" button → generates a single-use 14-day token → shows the claim URL (built from window.location.origin) + คัดลอก copy-to-clipboard; if the contractor is already bound to a portal user (contractor_users, staff RLS read) it shows "เชื่อมบัญชีพอร์ทัลแล้ว" instead. Verified-by-checklist for the UI (pure buildClaimUrl carries its tests; the action gate + RPC are existing/tested); auth-gated PM page → no preview. **The U2c operator phone smoke test is now unblocked:** PM opens a contractor → สร้างลิงก์เชิญ → sends the link via LINE → DC claims → DC uploads their ID card on /portal → confirm it lands + that they cannot reach another contractor's docs.

## Spec 134 U1 - Purchase-order detail page + ticket link-in (2026-06-17)

Status: COMPLETE — 2026-06-17. **App-only — NO migration / NO prod gate** (reads the spec-115 `purchase_orders` table + its existing back-office SELECT RLS; no schema change). typecheck · lint · **959 unit** (+13) · all green. Closes the PO **viewing** gap ADR 0044 / spec 115 left: POs were data-only (derived status/total, no screen) — once tickets were bundled, the PO scattered back into the worklist as loose rows. First unit of spec 134 (operator decision this session: PO detail + worklist grouping, **no new primary tab**; partial delivery = across-ticket for ~98%, split-on-receipt for the 1–2%, gated to U3+ADR). **New page** `/requests/orders/[poId]` (`src/app/requests/orders/[poId]/page.tsx`) — a drill-down UNDER the purchasing surface (DetailHeader back-bar to /requests, not a HubNav tab; static `orders` segment beats the sibling `[requestId]` dynamic route). PURCHASING_ROLES gate (SA sees PO structure + roll-up); RLS decides readability so unknown id == forbidden id == Thai 404 (the /requests convention). **Money posture (spec 106 / ADR 0038):** per-line `amount` + the PO total read ONLY via the admin client and shown ONLY to back office (`isBackOfficeRole` = pm/procurement/super, NOT site_admin); the derived STATUS needs no money so SA still sees it. **Pure seam (TDD, failing test first):** `src/lib/purchasing/po-detail.ts` `buildPoDetailView(lines)` → `{status, total, activeLineCount}` — composes spec-115 `derivePurchaseOrderStatus` + `purchaseOrderTotal` and applies the ADR-0044-§5 rejected/cancelled exclusion to the total + count (the one piece neither helper covers); 5 unit tests. **Supporting:** `PURCHASE_ORDER_STATUS_LABEL` (Thai; open/ordered/partially_received/received — derived union, not a DB enum, so its own label test outside the Constants-driven MAPS) + `purchaseOrderStatusPillClasses` (maps onto the per-ticket palette: open zinc · ordered amber · partial sky · received emerald; exhaustive switch + tests in status-colors.test). **Link-in:** `/requests/[requestId]` now reads the PO's `po_number` and shows "ส่วนของใบสั่งซื้อ PO-#### →" when a ticket is grouped (replaces the spec-125 "no PO detail page yet" note). **Verified-by-checklist** (auth-gated page → no preview: needs a LINE session + back-office role + a real PO with members; the pure roll-up + label + pill carry the tests). **Next:** U2 = worklist กำลังจัดส่ง band groups by PO (phone cards + desktop grid); **U3 (within-ticket partial via split) stays GATED on a new ADR amending 0044 §7** — amount-split + photo-requirement + which-row-keeps-identity decisions belong there.

## Spec 134 U2a - Worklist PO grouping (phone) + Lalamove research (2026-06-17)

Status: COMPLETE — 2026-06-17. **App-only — NO migration / NO prod gate** (reads spec-115 purchase_orders + existing RLS). typecheck · lint · **963 unit** (+4) · all green. Second slice of spec 134. Operator asked to also handle "proof attachments" + "check Lalamove API (apply future soon)". **U2 split (per spec allowance): 2a = pure helper + phone cards (THIS unit); 2b = desktop grid grouping (deferred — the ProcurementGrid table sub-grouping + prev/next nav + bundle-selection is heavy client work, kept clean for its own session).** **Pure seam (TDD, failing test first):** `src/lib/purchasing/po-grouping.ts` `groupByPurchaseOrder(rows)` → `{poGroups (first-appearance order), loose}`; 4 unit tests. **Wiring:** `purchase_order_id` added to `PR_LIST_COLUMNS` (and the duplicate append removed from the ticket detail select); `/requests` procurement phone pipeline now collapses the กำลังจัดส่ง band — for each PO appearing there it reads the PO facts (po_number/supplier/eta) + derives status+line-count from the PO's **FULL** member set (not just the in-transit rows visible under any active filter) via `buildPoDetailView`, rendering one `PoGroupCard` (links to the U1 detail) per PO with loose tickets keeping their own `PurchaseRequestCard`. Desktop grid + non-procurement list unchanged. New server-safe component `po-group-card.tsx` (single anchor, PO status pill). **Verified-by-checklist** (auth-gated procurement page → no preview; the pure grouper + roll-up carry the tests). **Lalamove research (NOT built):** `docs/research/lalamove-api-2026-06.md` — v3 API (HMAC-SHA256 signing, sandbox/prod base URLs, quotation→order→track→POD endpoints, webhook v3 incl. POD_STATUS_CHANGED + out-of-order/retry/200-fast constraints, TH vehicle tiers, prepaid-wallet billing, §8 sandbox/partner-support blockers). Design seams added to spec 134 as **Unit 4 (FUTURE)**: proof-of-delivery = new `proof_of_delivery` attachment purpose (carrier-provenance, copied into our Storage, PO-anchored + fanned to tickets); provider-abstracted `DeliveryProvider` + dispatch-outbox + webhook-inbox (mirrors spec-128 bank pattern + notification_outbox). **Open decision surfaced to operator:** ship a MANUAL proof-of-delivery uploader near-term (independent of Lalamove, forward-compatible) vs wait and land both with the courier integration. **Next:** U2b (desktop grid PO grouping); U3 (within-ticket split, GATED on ADR); U4 (proof/dispatch, blocked on Lalamove creds).

## Spec 134 U4a-i - PO-attachment purpose discriminator (migration) (2026-06-17)

Status: SCHEMA MIGRATION — on branch `feat/spec134-u4a-po-attachment-purpose`, **awaiting operator PR + merge + `db:push`** (change-management gate; NOT merge-auto — the risky/schema exception). Operator chose (2026-06-17) a MANUAL proof-of-delivery uploader near-term ("upload first", before U2b). `purchase_order_attachments` (spec 125) is deliberately single-purpose, so a distinct proof category needs schema. **Migration** `20260713000000_po_attachment_purpose.sql`: new `purchase_order_attachment_purpose` enum (`source_document` default + `proof_of_delivery`) — a FRESH `create type` (not `alter type add value`), so its labels are usable in the same migration (the 20260622000100 hazard doesn't apply); `purpose` column added NOT NULL DEFAULT `source_document` (existing rows + the create-PO source-doc INSERT path keep working with no code change); column-scoped `grant insert (purpose)` so app sessions can set it (ADR 0038); the existing back-office INSERT policy is unchanged (it doesn't constrain the purpose column — proof upload is the same back-office/site gate); `purchase_order_attachments_current` view recreated to carry `purpose` (security_invoker + ADR 0009/0015 anti-join preserved). **pgTAP** file 50 extended 23→29 (enum labels, table+view column, default-to-source_document behavioral check, proof_of_delivery insert + view surfaces it) — runs post-apply. **App unchanged** (typecheck/lint/963 unit stay green from f716605). **Next after apply:** `db:types` regen (will add `purpose` to the generated types app+worker), then **U4a-ii** = `ProofOfDeliveryUploader` on the PO detail (mirror InvoiceUploader, writes purpose='proof_of_delivery' to po-attachments) + `addProofOfDeliveryAttachment` action + a หลักฐานการรับของ display section. The Lalamove auto-POD (U4b, blocked on creds) fans into the SAME purpose.

## Spec 134 U4a-ii - Manual proof-of-delivery uploader (UI) (2026-06-17)

Status: COMPLETE — 2026-06-17. **App-only** (the U4a-i migration `20260713000000_po_attachment_purpose` was merged + `db:push`ed to prod this session; `db:test` 59 files / 1256 assertions / 0 failures; `db:types` regenerated app+worker, committed e670b7b). typecheck · lint · **963 unit** · all green. Completes the operator-chosen ("upload first") manual proof-of-delivery slot. **Action** `addProofOfDeliveryAttachment` (requests/actions.ts) — mirrors `addPurchaseOrderAttachment` but stamps `purpose='proof_of_delivery'`; same po-attachments bucket + path + back-office INSERT policy + idempotent 23505 replay. **Component** `ProofOfDeliveryUploader` (mirrors InvoiceUploader: prepare/downscale or raw PDF → direct upload to po-attachments at {po_id}/{att}.{ext} → action → refresh). **PO detail (U1 page)** gains a "หลักฐานการรับของ" section: reads `purchase_order_attachments_current` filtered `purpose='proof_of_delivery'`, signs URLs (private bucket, service-role), renders image lightbox group + PDF iframes + the uploader (shown to all PO-detail viewers = the insert-policy role set; RLS re-enforces). **Leak fix:** the ticket-detail source-doc query (`เอกสารใบสั่งซื้อ`) now filters `purpose='source_document'` so proof rows never show there. **Verified-by-checklist** (auth-gated page + storage → no preview; matches how InvoiceUploader/addPurchaseOrderAttachment shipped; pgTAP file 50 covers the schema). **U4a feature-complete.** Lalamove auto-POD (U4b, blocked on creds) will fan into this same `proof_of_delivery` purpose. **Next:** U2b (desktop grid PO grouping); U3 (within-ticket split, ADR-gated).

## Spec 134 U2b - Desktop grid PO grouping (2026-06-17)

Status: COMPLETE — 2026-06-17. **App-only.** typecheck · lint · **963 unit** · all green. Finishes U2 (U2a was the phone cards): the desktop ProcurementGrid กำลังจัดส่ง band now renders a **PO header row** before each bundled order's members, linking to the PO detail (U1). **Page:** the in_transit gridGroups items are pre-ordered via `groupByPurchaseOrder` so each PO's members are contiguous (PO groups first-appearance, then loose) — `flattenRecordOrder`/prev-next drawer nav follows this visual order with no extra change; `purchase_order_id` added to the `ProcurementGridRecord` mapping; a serializable `poFacts` record (poNumber/supplier/derived status/lineCount, reusing the phone roll-up) passed to the grid. **Grid:** `PoHeaderRow` (Package icon · PO-#### · supplier · status pill · N รายการ · chevron; one `<Link>` to /requests/orders/[poId], NOT a drawer-opening record); inserted in `BandRows` only for the in_transit band when a row's `purchase_order_id` differs from the previous row's (contiguity guaranteed by the pre-order). Other bands + selection/checkbox (to_order only) untouched. **Fixtures:** `purchase_order_id: null` added to the three `ProcurementGridRecord` factories (grid-preview page + procurement-grid-health + phone-po-basket tests). **Verified-by-checklist** (auth-gated procurement page → no preview; the pure `groupByPurchaseOrder` + roll-up carry the tests; /grid-preview fixtures carry no PO so headers don't render there). **U2 feature-complete (phone + desktop).** **Next:** U3 (within-ticket split, ADR-gated); U4b (Lalamove auto-POD, blocked on creds).

## Spec 134 U3 - Within-ticket partial delivery via split-on-receipt (2026-06-17)

Status: COMPLETE on prod — 2026-06-17 (ADR 0052 accepted). Migration `20260714000000_purchase_request_partial_split` merged + `db:push`ed (dry-run clean); `db:test` **60 files / 1280 assertions / 0 failures** (new file 60 = 24); `db:types` regenerated app+worker (commit 7291dd8). The 1–2% within-ticket case. **Schema:** `split_from_request_id` lineage column (RPC-only by the column-scoped grant posture, ADR 0038) + `split_purchase_request_on_receipt(p_request_id, p_received_qty, p_received_by?, p_delivery_note?, p_delivered_amount?)` SECURITY DEFINER RPC. Splits an in-transit PO member into a delivered portion (the ORIGINAL, reduced — sets delivered_at so the existing derive trigger flips it to `delivered` + the audit trigger logs delivery) + a REMAINING child (new row, on_route, same PO, `split_from_request_id`=original, pr_number from the sequence default). Guards: back-office, in-transit member (purchased/on_route), `0<received<ordered`, delivered-amount range. **Amount (ADR 0052 §4, operator: proportional default + buyer-editable):** omit `p_delivered_amount` → `round(amount×received/ordered,2)`; supply → buyer value; remainder = original − delivered (family sum = original exactly, per-WP spend preserved). One split audit row (action 'update', ADR 0027/0031 no-new-enum precedent). **UI (U3-ii):** `splitPurchaseRequestOnReceipt` action (relays the RPC) + `PartialReceiveControl` (a "รับบางส่วน" expander on each in-transit PO-detail line — qty + editable proportional-prefill amount [back office only] + note); after submit the PO badge becomes `partially_received` via the roll-up (no new derive/display logic — the split yields ordinary tickets). **Verified-by-checklist** for the UI (auth-gated; the RPC carries the pgTAP). **Spec 134 partial-delivery story (U1 detail · U2 a+b grouping · U3 split · U4a proof) is COMPLETE on prod.** Only U4b (Lalamove auto-POD) remains, blocked on sandbox creds.

## Spec 134 U5 - PO-level receive flow + demote within-ticket partial (2026-06-17)

Status: COMPLETE on prod — 2026-06-17 (ADR 0053). Migration `20260715000000_receive_po_lines` merged + db:push'd (dry-run clean); db:test **61 files / 1290 / 0** (new file 61 = 10); db:types reconciled (1f50e47). **Reframes the receiving UX to the operator's real delivery distribution** (A ~85% whole PO · B ~14% whole-ticket subset waiting on restock · C ~1% within-ticket made-to-order) — the photo-per-ticket model made A/B tedious while U3's รับบางส่วน was the loud control; now inverted. **Migration:** `receive_po_lines(p_request_ids uuid[], p_received_by?, p_delivery_note?)` SECURITY DEFINER RPC — back-office gate, in-transit-only (`status in purchased/on_route`), all-or-nothing; sets delivered_at+received_by+delivery_note → the existing derive trigger flips status to delivered + the audit trigger logs each line (standard `purchase_request_delivery` rows). No new column; spec-24 photo path + the roll-up unchanged. **UI:** `receivePoLines` action; `PoReceiveSection` (the PO detail's prominent "รับของ" checklist — every in-transit line **ticked by default** = Case A one tap; untick the waiting lines = Case B subset, the rest stay on_route → PO `partially_received` via roll-up); the within-ticket split (U3) **demoted** to a quiet "แบ่งรับบางส่วน" link per line via a new `subtle`/`triggerLabel` prop on `PartialReceiveControl` (Case C). The static "รายการในใบสั่งซื้อ" list stays as read-only PO contents. **Delivery cost** ("sometimes paid, sometimes free") deferred to U4b/courier (operator). **Verified-by-checklist** (auth-gated; RPC carries the pgTAP). **Spec 134 now: U1·U2·U3·U4a·U5 on prod; only U4b (Lalamove) parked on creds.**

## Spec 134 U6 - PO progress stepper + delivering (in_transit) roll-up state (2026-06-17)

Status: COMPLETE on prod — 2026-06-17. **App-only** (pure helper + labels + a presentational component; no schema). typecheck · lint · **969 unit** (+6) · green. Closes two operator-reported gaps on the PO detail: (1) no progress tracker; (2) delivery felt missing — the PO jumped ordered → received because the roll-up folded `on_route` into "ordered". **Roll-up (amends ADR 0044 §5):** `PurchaseOrderStatus` gains `in_transit` (กำลังจัดส่ง); `derivePurchaseOrderStatus` returns it when ≥1 active member is `on_route` and none delivered yet (between `ordered` = all purchased/none shipped, and `partially_received`). Label `กำลังจัดส่ง` + pill SKY (the per-ticket on_route hue; partially_received also SKY, label disambiguates). **Stepper:** new pure `purchaseOrderStageStates(status)` → 3 stages [ordered, in_transit, received] each done/current/pending (+ partial flag on received for partially_received); `PurchaseOrderTracker` (server-safe, mirrors the spec-22 per-ticket tracker geometry) renders สั่งซื้อ → จัดส่ง → รับของ on the PO detail summary card. So the delivering stage is always visible as a milestone (even when shipment-recording is skipped, ADR 0027) and shows live (sky/กำลังจัดส่ง) once `record_shipment` fires. TDD: derive on_route cases flipped ordered→in_transit + stageStates tests first; i18n + status-colors PO_STATES extended. List surfaces (phone PO card, desktop PO header) inherit the new label/pill automatically. **Verified-by-checklist** for the page render (auth-gated; pure helpers carry the tests).

## Spec 134 U7-ii - PO delivery breakdown UI (งวดส่ง) (2026-06-17)

Status: COMPLETE on prod — 2026-06-17. **App-only** (U7-i migration `20260716000000_delivery_batch_id` already merged + db:push'd this session: column + receive_po_lines/split stamping; db:test **61 files / 1293 / 0**; db:types 3e13abd). Answers the operator's "what if partial delivery branches the tracker?" — chosen render = breakdown list under the stepper (not a literal fork-tree), batches grouped by `delivery_batch_id`. **Pure helper** `src/lib/purchasing/delivery-batches.ts` `groupDeliveryBatches(lines)` → `{batches[] (by delivery_batch_id, fallback delivered_at, oldest first), pending {count, earliestEta} | null}`, excludes rejected/cancelled (6 unit tests, TDD). **Component** `PoDeliveryBreakdown` (server-safe): "การจัดส่ง" — งวดที่ N · count · รับแล้ว <date> ✓ rows + a ค้างส่ง · count · คาด <eta> ⏳ row (lucide Check/Clock). **PO detail:** members select += `delivery_batch_id`; rendered under `PurchaseOrderTracker` **only when the PO forked** (`batches.length > 1 || pending`), so the 85% one-delivery PO keeps just the linear stepper. **Verified-by-checklist** (auth-gated; helper carries the tests). **Spec 134 = U1·U2·U3·U4a·U5·U6·U7 on prod;** only U4b (Lalamove auto-POD + per-delivery cost) parked on creds — `delivery_batch_id` is its bridge (a courier order = one batch).

## Spec 134 U8 - Receiving is a site action (drop procurement from the receive gate) (2026-06-17)

Status: COMPLETE on prod — 2026-06-17. Operator insight: the purchase team is off-site and only knows the planned delivery (ETA); actual receipt must be confirmed by people on site. Discovery: the spec-23/ADR-0028 delivery-confirmation PHOTO path ALREADY gated to (site_admin, project_manager, super_admin) — procurement was never allowed there; the U5 `receive_po_lines` + U3 `split_purchase_request_on_receipt` RPCs were the outliers (allowed back-office incl procurement). **Migration** `20260717000000_receive_site_only` CREATE OR REPLACE both RPCs with the role gate narrowed to the site set (bodies otherwise identical → same signatures → db:types a no-op, confirmed zero drift). **UI:** PO detail computes `canReceive = SITE_STAFF_ROLES.includes(ctx.role)`; `PoReceiveSection` (and the nested รับบางส่วน split) render only when canReceive — procurement still sees the PO, tracker, delivery breakdown + lines read-only, no รับของ controls. **pgTAP:** file 61 (+1) + file 60 (+1) assert procurement is refused (42501) — **61 files / 1295 / 0**. typecheck · lint · **975 unit** green. The proof-of-delivery uploader (U4a) stays back-office for now (it's evidence, not the receive-status action) — possible follow-up if proof should also be site-only. **Spec 134 = U1·U2·U3·U4a·U5·U6·U7·U8 on prod;** only U4b (Lalamove auto-POD + per-delivery cost) parked on creds.
