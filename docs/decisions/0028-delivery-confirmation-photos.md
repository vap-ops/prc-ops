# ADR 0028 — Purchase-request attachments table + delivery-confirmation purpose

**Status:** Accepted — 2026-06-11. Spec 23 (extends the locked spec 16 §4
design). Numbering note: spec 16 referred to the AppSheet image-bridge
ADR as "0027"; 0027 was taken by the on_route status, so the bridge ADR
is renumbered **0029** (unwritten until P3).

## Context

The operator needs site staff to attach photos proving goods were
received (spec 23). Spec 16 §4 already locked a full
`purchase_request_attachments` architecture (append-only + tombstone
removal, token side table, private bucket, security_invoker views) for
requester reference attachments — but its INSERT policy freezes the
attachment set once the parent leaves `requested` (Q2), which forecloses
receipt photos by design.

## Decision

Ship the locked spec-16 §4 schema now, with one extension:

- **`purpose` discriminator** — enum
  `purchase_request_attachment_purpose ('reference',
'delivery_confirmation')`, NOT NULL, default `'reference'` (keeps the
  spec-16 reference flow's inserts unchanged when its UI ships).
- **Second INSERT-policy branch** (operator decision 2026-06-11,
  reversing spec-16 Q2 for this purpose only):
  `purpose = 'delivery_confirmation'` rows require kind `image`, parent
  `status = 'delivered'`, `created_by = auth.uid()`, requester-capable
  role. ANY staff member may confirm receipt — the receiver is often not
  the requester — so this branch deliberately omits the
  `requested_by = auth.uid()` ownership check that the reference branch
  keeps.
- **Why delivered-only (not on_route):** receipt confirmation is
  evidence FOR a recorded delivery; AppSheet remains the authority that
  goods arrived (ADR 0025 derive posture). Photos before `delivered`
  would let the app contradict the back office.
- **Removal:** tombstones extend to confirmation photos — creator-only,
  while the parent remains `delivered`. Same well-formedness CHECK,
  composite same-parent/same-kind FK, and one-tombstone-per-target
  partial unique index as the locked design. Tombstones inherit purpose
  semantics via their target; no purpose check needed on tombstones
  (payload-NULL rows).
- **CHECK `pra_purpose_kind`:** content rows with
  `purpose = 'delivery_confirmation'` must have `kind = 'image'`.
- Storage upload policy gains the mirrored second branch (path bound to
  `{project_id}/{purchase_request_id}/{attachment_id}.{ext}`, parent
  delivered, requester-capable role — uploader ownership of the parent
  NOT required, matching the table branch).
- Views/token table/grants ship exactly as locked (views additionally
  project `purpose`; the token trigger still fires for every image
  content row — confirmation photos get tokens too, harmless and keeps
  the trigger purpose-blind).

## Consequences

- Spec-16 P2's remaining scope shrinks to pure UI (stager + reference
  display); its migrations are superseded by spec 23's.
- The recorded TOCTOU race (spec 16 / ADR 0026 §g) gains a sibling: a
  confirmation photo whose snapshot saw `delivered` could land just
  after a (hypothetical future) status reversal — accepted, same class.
- pgTAP must pin BOTH policy branches and the negative spaces between
  them (reference insert on delivered parent denied; confirmation insert
  on requested/purchased parent denied; confirmation link denied;
  non-creator tombstone of a confirmation photo denied).
- AppSheet sees confirmation photos through the `_appsheet` view like
  any attachment (purchase admins can audit receipt evidence). The
  Tier-2 smoke re-run duty applies (role-touching migration).
