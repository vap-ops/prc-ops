# ADR 0049 — AI feature governance: toggles, system prompts, access control

- Status: Accepted (design) — 2026-06-16. Build phased (specs TBD). Supersedes the
  toggle sketch discussed alongside ADR 0046 Layer C.
- Context: ADR 0046 Layer C (AI extraction of a PO source document) is the first AI
  feature, currently HELD. AI will spread across roles over time (see the catalog
  below). AI is **paid** (Anthropic API, per-token) and **sends data out**
  (purchase docs, photos, notes leave the instance for the API), so the operator
  (`super_admin`) needs a real control plane: a kill-switch, per-feature control,
  editable prompts, and control over _who_ gets each feature. prc-ops is
  **instance-per-customer** (ADR 0035), so this governs one customer's instance.

## The gate that already exists

No `ANTHROPIC_API_KEY` in the deploy env → **all AI is dead** (the key is optional
in `env.server.ts`, the spec-32 "silent no-op until configured" pattern). The
governance below sits **on top of** that infra gate — it is the deliberate
operator control, not the thing that makes AI possible.

## Decisions

1. **Three composed gates; default OFF (opt-in).** An AI feature runs for a caller
   only if **all** hold: (a) API key present (infra), (b) the **master** AI switch
   is on, (c) the **per-feature** switch is on, (d) the caller's **role is allowed**
   for that feature, (e) the caller is not **per-user denied**. Default OFF
   everywhere — AI costs money and sends data out, so it is never on by accident
   (same opt-in posture as the held gamification feature). The master is the panic
   button (off → every feature off regardless of per-feature state).

2. **A feature registry table — new feature = one seeded-disabled row, no schema
   churn.**

   ```
   ai_features(
     feature_key            text primary key,   -- 'ai_master' is the master row
     enabled                boolean not null default false,
     allowed_roles          text[]  not null default '{}',   -- super_admin-editable
     system_prompt_override text,                              -- null = use code default
     updated_by             uuid,
     updated_at             timestamptz
   )
   ```

   Master = the `ai_master` row (`allowed_roles`/`system_prompt_override` ignored).
   Each feature ships a migration that inserts its row `enabled=false` with a
   sensible default `allowed_roles`. **super_admin-only write** via a SECURITY
   DEFINER RPC (mirrors `update_project_settings`, ADR 0042); read server-side at
   each AI call site. Every change writes an `audit_log` row. Per-user overrides are
   a recorded seam (a small `ai_user_access(user_id, feature_key, allowed)` table) —
   role-grain is v1, per-user is v2.

3. **Per-feature system-prompt override (super_admin-editable), with a hard money/
   state invariant.** Code ships a default prompt per feature (versioned in its
   spec). super_admin may **override** it in the UI (stored in `system_prompt_override`,
   length-capped, audited) and **reset to default**. Rationale: prompts need
   field-tuning (Thai phrasing, supplier-doc quirks) without a redeploy. **INVARIANT
   that the override cannot break:** AI output is _never_ trusted to write money or
   change state. Extraction only **prefills** a form the human verifies and submits;
   amounts/VAT stay RPC-written (ADR 0044/0045). A bad prompt can degrade extraction
   quality but **cannot move money or mutate domain state** — the human-verify gate
   is the safety boundary, not the prompt. Model / effort / temperature stay in code
   (not operator knobs — operators don't tune models).

4. **Access control = role-scoped (v1), per-user override (seam).** Each feature has
   a default `allowed_roles` set in code; super_admin can edit it per feature. This
   is finer than the role itself: a `procurement` user gets extraction because
   extraction's `allowed_roles` includes `procurement`, not merely because they are
   procurement. The broadest access lever is **changing a user's role** — see ADR
   0050; role-change affects all of AI (and everything else) at once. Three tiers,
   coarse→fine: change role (ADR 0050) ⊃ per-feature role allowlist (here) ⊃ per-user
   override (seam).

5. **The AI application catalog (informs the feature_keys).** Not all built — this
   is the map the registry grows into. Status: ▶ in flight · ◷ next · ○ later.

   | Role                        | AI application                                                | feature_key (proposed) | Status |
   | --------------------------- | ------------------------------------------------------------- | ---------------------- | ------ |
   | procurement                 | PO source-doc → prefill the create-PO form (ADR 0046 Layer C) | `po_doc_extract`       | ▶      |
   | procurement                 | invoice/receipt → match & reconcile against a PO              | `invoice_reconcile`    | ○      |
   | procurement                 | quote price sanity-check vs historical supplier spend         | `price_sanity`         | ○      |
   | site_admin                  | Thai free-text / voice note → structured purchase request     | `request_from_note`    | ◷      |
   | site_admin                  | photo → suggest WP phase / auto-caption                       | `photo_tag`            | ○      |
   | site_admin                  | delivery/receipt photo sanity ("does it show the item?")      | `receipt_sanity`       | ○      |
   | PM / super_admin            | project / WP progress digest (attention, overdue POs)         | `project_digest`       | ◷      |
   | PM / super_admin            | report executive-summary draft (PDF reports)                  | `report_summary`       | ○      |
   | PM / super_admin            | ask-your-data Q&A over the project (semantic)                 | `project_qa`           | ○      |
   | PM / super_admin            | budget-vs-spend anomaly narrative                             | `spend_anomaly`        | ○      |
   | accounting (v3)             | tax-invoice (ใบกำกับภาษี) / WHT doc extraction                | `tax_doc_extract`      | ○      |
   | hr / accounting (v3)        | labor-log / payroll anomaly explanation                       | `labor_anomaly`        | ○      |
   | any (cross-role)            | Thai↔EN translation / notes auto-summarize                    | `text_assist`          | ○      |
   | technician / subcon (v2/v3) | task checklist / instruction generation                       | `task_assist`          | ○      |
   | visitor                     | none — no AI for unpromoted accounts                          | —                      | —      |

   Each row, when built, ships its own spec + a seeded-disabled `ai_features` row
   with a default `allowed_roles`. `super_admin` can use any feature it enables
   (full-access role).

## Consequences

- **Phased build.** When Layer C resumes: (1) the `ai_features` table + master +
  the `po_doc_extract` row + the three-gate check helper + a super_admin settings
  surface (toggle + the data-handling consent shown at enable time); (2) per-feature
  system-prompt override UI; (3) access-config UI (edit `allowed_roles`); (4) per-user
  override (seam). The extraction feature itself (the Claude call) is ADR 0046 Layer C.
- **Surface:** a `super_admin`-only admin/control area (under `/settings` or a new
  `/admin`), `requireRole(super_admin)`. Shows, per feature: on/off, allowed roles,
  the prompt (default or overridden), and _why_ it's off when off ("no API key" vs
  "disabled by admin") so it's never a mystery.
- **Money posture unchanged.** AI never writes money/state; prefills are
  human-verified; amounts/VAT stay RPC-written. Editable prompts cannot bypass this.
- **Data-handling.** Enabling a feature sends the relevant artifact (doc/photo/text)
  to the Anthropic API. The enable action surfaces this explicitly to super_admin
  (consent at the toggle).
- **Audit.** Every toggle, allowed-roles edit, and prompt override writes an
  `audit_log` row (who/when/old→new).
- Related: ADR 0046 (the document-first PO + Layer C extraction it governs), ADR
  0050 (super_admin role management — the coarsest access lever), ADR 0010 (visitor
  default / manual promotion this generalizes), ADR 0035 (instance-per-customer).
