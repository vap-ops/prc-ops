# Spec 136 — Create a purchase request on the WP page only (+ PM self-approve)

- Status: Draft (2026-06-17). Operator: "the สร้างคำขอซื้อ section on the คำขอซื้อ
  (/requests) tab should be removed — we don't allow users to make a request there
  anyway." Requests are raised from the work-package page (WP-centric, spec 29).

## Problem

`/requests` carried a สร้างคำขอซื้อ section (the spec-10 `?wp=`-pinned form + a
"create from the WP page" notice). The SA project WP page already creates inline
(spec 29); the PM **review** WP page (`/review/work-packages/[id]`) instead linked OUT
to `/requests?wp=` — the only live entry into that section. So creation was split
across two patterns and the /requests tab wrongly looked like a create surface.

## Change

- **Remove the สร้างคำขอซื้อ section from `/requests`** + the now-dead `?wp=` machinery
  (pinned-WP resolution, the contextual back-bar, the `?wp=`-preserving filter-chip
  hrefs). `/requests` is purely the worklist.
- **PM review WP page creates inline** — replace the "สร้างคำขอซื้อ →" cross-tab link
  with the shared `PurchaseRequestForm` in a `<details>` (mirrors the project WP page,
  spec 29). Both WP pages now create inline; `/requests?wp=` is fully dead.
- **PM self-approve (operator):** the form gains a `canSelfApprove` prop (PM/super). When
  set, the submit becomes **"สร้างและอนุมัติ"** — after create (+ attachment flush) it
  chains `decidePurchaseRequest(approved)` so a PM-raised request is approved in one tap
  (a PM is the approver; no point leaving their own request pending). SA keeps the plain
  "ส่งคำขอซื้อ". Self-approval already works at the data layer (`decidePurchaseRequest` is
  a user-session UPDATE gated only by `status='requested'`; no requester≠approver guard,
  approved_by + the audit trigger record the actor) — **no migration.**

## Out of scope / seams

A create-and-route-to-another-approver flow (v1 has only PM/super approvers). Editing
the `/requests` worklist filters. Cross-instance.

## Verification

lint · typecheck · test green. App-only, no schema → no db:push. UI is auth-gated →
verified-by-checklist; operator device pass is acceptance (raise a request from a WP as
SA → pending; as PM → "สร้างและอนุมัติ" → approved; /requests has no create section).
