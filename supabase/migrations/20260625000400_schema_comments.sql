-- Data-architecture hardening (rank 6) — make the schema self-describing.
-- Before this there were 0 COMMENT ON TABLE and 4 COMMENT ON COLUMN across the
-- whole schema; every load-bearing semantic (supersede anti-join, tombstone
-- rules, the money boundary, enum meanings, point-in-time snapshots) lived only
-- in migration headers and ADRs that an LLM/text-to-SQL agent querying the live
-- DB never sees. pg_catalog surfaces these as the agent's (and a new
-- engineer's) data dictionary. Comments only — zero behavior change.

-- ===== Core project hierarchy =====
comment on table public.projects is
  'Top-level construction project. status: active|on_hold|completed|archived.';
comment on table public.deliverables is
  'Named grouping of work_packages within a project (its own table, not denormalized columns, to avoid rename drift). work_packages.deliverable_id is SET NULL on delete.';
comment on table public.work_packages is
  'A unit of work within a project (Thai: รายการงาน) — the center of the operator information model. status is the WP lifecycle enum; contractor_id is the optional WP owner (spec 31); deliverable_id is the optional grouping.';
comment on column public.work_packages.status is
  'WP lifecycle enum (e.g. not_started|in_progress|pending_approval|complete|on_hold). Never free-text.';
comment on column public.work_packages.contractor_id is
  'Optional owning contractor for this WP (spec 31). FK to contractors.';

-- ===== Users / audit =====
comment on table public.users is
  'Application users. id is both PK and FK to auth.users(id) (1:1, auto-created by trigger). role: the 8 PRC roles plus visitor (default for new signups, ADR 0010).';
comment on column public.users.role is
  'user_role enum: site_admin|project_manager|super_admin (v1 live) + project_coordinator|procurement|technician|hr|subcon_manager|accounting (future) + visitor (default).';
comment on table public.audit_log is
  'Append-only event stream (ADR 0004), immutability triple-enforced: revoked UPDATE/DELETE + no mutating RLS policy + a BEFORE trigger raising P0001. The authoritative provenance/event substrate (also the AI memory substrate). Never UPDATE/DELETE.';
comment on column public.audit_log.payload is
  'Polymorphic jsonb whose shape depends on action (e.g. labor_cost_freeze carries own_cost/old_own_cost; cancellation carries transition/cancelled_by). Intentionally untyped.';

-- ===== Progress photos =====
comment on table public.photo_logs is
  'Append-only progress photos by phase (before|during|after). Supersede pattern (ADR 0009): an edit inserts a new row whose superseded_by points at the replaced row; current state = anti-join (NOT EXISTS newer.superseded_by = id), never IS NULL. Never UPDATE.';
comment on column public.photo_logs.superseded_by is
  'Supersede pointer: this row is current iff no other row points at it. NULL on an original; set on the replacement-target relationship.';
comment on column public.photo_logs.storage_path is
  'Storage object path of the unmodified original (watermark rendered on demand). NULL = tombstone (a removed photo); CHECK ties (storage_path IS NULL) = (superseded_by IS NOT NULL).';
comment on table public.photo_markups is
  'Append-only annotations on a photo_log. Supersede chain scoped by a composite identity FK (id, photo_log_id) so a tombstone can only point at a row of the same parent.';

-- ===== Approvals =====
comment on table public.approvals is
  'Append-only WP approval decision event log. decision: approved|rejected|needs_revision. Current decision = the row with max(decided_at); this is an event log, NOT a supersede chain (no superseded_by).';

-- ===== Master data =====
comment on table public.contractors is
  'Subcontractor (DC crew) master. A contractor that worked a WP stays referencable forever — retire via a withheld DELETE grant, never row deletion.';
comment on table public.suppliers is
  'Material supplier master. purchase_requests.supplier_id links here; purchase_requests.supplier is a name snapshot.';
comment on table public.workers is
  'Labor master: own crew or subcontractor (DC) workers. worker_type: own|dc. day_rate is MONEY. contractor_id is the DC parent contractor; user_id links a worker to an app user (enables self-logging).';
comment on column public.workers.day_rate is
  'MONEY — daily rate in baht. ZERO authenticated grant; readable only via the service-role admin client behind requireRole(pm/super). Written only via set_worker_day_rate.';
comment on column public.workers.worker_type is
  'worker_type enum: own (own salaried crew) | dc (subcontractor, paid per logged day — see payroll).';

-- ===== Labor (daily capture + frozen cost) =====
comment on table public.labor_logs is
  'Append-only daily labor capture: one CURRENT row per (work_package, worker, work_date), enforced under an advisory lock in log_labor_day. Supersede + tombstone (ADR 0009/0015). DC days are payroll — hence audit-grade immutability. Never UPDATE.';
comment on column public.labor_logs.day_rate_snapshot is
  'MONEY — the day rate frozen at log time so a later workers.day_rate change never rewrites a worked day. ZERO authenticated grant (service-role only). The snapshot IS the source of truth for pay, not the live workers row.';
comment on column public.labor_logs.worker_type_snapshot is
  'worker_type frozen at log time. Payroll/cost filter on THIS, not the live workers row (a type flip must not rewrite history).';
comment on column public.labor_logs.contractor_id_snapshot is
  'Contractor id frozen at log time (bare uuid, intentionally no FK — point-in-time value, the contractor may later be retired).';
comment on column public.labor_logs.day_fraction is
  'day_fraction enum full|half, or NULL = tombstone (a removed day). CHECK: NULL only allowed when superseded_by is set.';
comment on column public.labor_logs.superseded_by is
  'Supersede pointer (ADR 0009 anti-join). Current rows are those not pointed at.';
comment on table public.wp_labor_costs is
  'Deliberately-mutable per-WP frozen labor cost (one row per WP, UPSERT) — the audit_log carries the change history, so the snapshot itself need not be append-only. Frozen at WP close and re-frozen explicitly on drift. own_cost/dc_cost are MONEY.';
comment on column public.wp_labor_costs.own_cost is
  'MONEY — frozen own-crew labor cost (baht). ZERO authenticated grant (service-role only).';
comment on column public.wp_labor_costs.dc_cost is
  'MONEY — frozen subcontractor (DC) labor cost (baht). ZERO authenticated grant (service-role only).';

-- ===== Purchasing =====
comment on table public.purchase_requests is
  'Material purchase requests. source discriminates origin: app | appsheet (legacy writer) | site_purchase (on-site cash buy, born terminal). status is the lifecycle enum advanced by triggers/RPCs, never a string flip.';
comment on column public.purchase_requests.source is
  'Origin discriminator: app | appsheet | site_purchase. Drives which surfaces and uploaders apply (CHECK pr_source_valid).';
comment on column public.purchase_requests.supplier is
  'Supplier NAME snapshot at purchase time (deliberate point-in-time copy + AppSheet continuity). supplier_id is the analytics FK; do not sync this text to suppliers.name.';
comment on column public.purchase_requests.received_by is
  'Display-name snapshot of who received delivery (point-in-time text). The structured receiver identity is received_by_id (FK to users).';
comment on table public.purchase_request_attachments is
  'Append-only attachments on a purchase_request. purpose: reference|delivery_confirmation|invoice. kind: image|link. Supersede + tombstone, scoped by a composite identity FK.';
comment on table public.purchase_request_attachment_tokens is
  'Short-lived upload tokens authorizing a client to attach to a specific purchase_request.';

-- ===== Membership / async / infra =====
comment on table public.work_package_members is
  'Composite-PK join table (work_package_id, user_id) — WP membership/assignment. Correct junction table, no surrogate key.';
comment on table public.reports is
  'Async-generated PDF report jobs (deliberately mutable status row, claimed atomically). params jsonb holds the PM content choices (scope/photos); parsed defensively so legacy {} renders the original report.';
comment on table public.notification_outbox is
  'LINE-push delivery queue (deliberately mutable). status: pending|sending|sent|failed|expired. This is delivery STATE, not evidence — terminal rows are pruned on a daily cron (prune_notification_outbox).';
comment on table public.login_handoffs is
  'Short-lived PWA login-handoff tokens. status: pending|approved|consumed.';
