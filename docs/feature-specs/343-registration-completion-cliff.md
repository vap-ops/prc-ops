# Spec 343 — registration completion: prep screen + a pending state that tells the truth

**Status:** design approved in chat 2026-07-22. Build not started.
**Origin:** operator report — "users reported nowhere to give consent, nor uploads",
raised while walking through contractor-team onboarding.
**Related:** [328 subcon-member onboarding](328-subcon-member-onboarding.md) ·
[333 deferred-docs office approve](333-deferred-docs-office-approve.md) ·
[342 invite-only office onboarding](342-office-invite-link.md) · spec 296 (document floors)

---

## 1. The problem, from live data

Every pending registration on prod is stuck at the same point. Queried
2026-07-22:

| employee | firm | days stuck | full_name | id_card | PDPA consent |
| --- | --- | --- | --- | --- | --- |
| PRC-26-0003 จารุวัฒน์ คงด้วง | — | 14.2 | ✅ | ❌ | ❌ |
| PRC-26-0004 ณัฐวุฒิ มิลลิมิตร | — | 14.1 | ✅ | ❌ | ❌ |
| PRC-26-0007 ธีรรัตน์ น้อยโฮม | วุฒินันท์ | 10.3 | ✅ | ❌ | ❌ |
| PRC-26-0031 เหิน เมืองงาม | ช่างอวย | 0.0 | ✅ | ❌ | ❌ |

4 of 4, identical shape — not a scatter. จารุวัฒน์ and ณัฐวุฒิ were personally
chased on 2026-07-21 and still have not moved. That rules out simple
inattention as the whole cause.

Three defects in the register workspace produce it.

**D1 — the page claims success before it has any.** The moment the profile
saves, `RegistrationPendingNotice` renders headed
`ส่งใบสมัครแล้ว รอการอนุมัติ`, with body
`ทีมงานได้รับใบสมัครของคุณแล้ว ไม่ต้องส่งบัตรให้ใครเพิ่ม …เปิดแอปอีกครั้งเพื่อดูสถานะได้ตลอด`.
The application is not submitted — it is missing two approval-floor items. The
phrase `ไม่ต้องส่งบัตรให้ใครเพิ่ม`, written as anti-phishing advice, reads to a
worker as *no ID card is needed*.

**D2 — the required steps render below the primary CTA.**
`staff-registration-form.tsx:306` renders `StaffDocuments` and
`StaffConsentCheckbox` **after** the full-width `บันทึก` button at `:300`. On a
phone a full-width primary CTA reads as the end of the form. The uploads and the
consent tick sit past it, below the fold.

**D3 — the only "what is missing" line self-suppresses.** The floor hint is
gated `{!floorMet && !consentedAt}` (`:653`). The instant an applicant ticks
consent while still owing an ID card, the sole text naming the outstanding item
disappears — it goes silent exactly one step from done.

Combined: the app tells the applicant they are finished, hides the two things
that would finish them, and removes the hint that says otherwise.

## 2. Constraint that shapes the design

A single all-required submit is **not possible**. `add_staff_registration_doc`
resolves the registration by `user_id = auth.uid()` and rejects any storage path
whose middle folder is not the caller's uid:

```
if storage.foldername(v_path) … [2] is distinct from v_uid::text … then
  raise exception 'add_staff_registration_doc: storage path does not match owner/purpose'
```

So no upload can exist before the registration row does. Create-then-complete is
structural. The honest model is a prepared two-step flow, not one form.

## 3. Non-goals — decided, recorded so they are not re-litigated

- **No office-staff upload proxy.** The original request. It handles neither D1
  nor D3, requires a new DEFINER RPC plus a walled storage path, and puts
  national-ID images in a third party's hands. Revisit only if drop-off survives
  this spec.
- **No consent proxy.** `record_staff_consent` binds to `auth.uid()`, and
  `approve_staff_registration` checks the PDPA record **outside** its defer
  branch — consent is required for every role, deferred or not. A third party
  recording someone's PDPA consent is a legal decision, not a technical one.
- **No technician document deferral.** `approve_staff_registration` refuses
  `p_defer_documents` when `p_role = 'technician'` by design: that approval mints
  a `workers` row, unlike office roles where it only sets `users.role`. Not
  reopened here.

## 4. Units

### U1 — the pending state stops lying (highest value; ship first)

Fixes D1, D2, D3. Code-only, no schema, no new PII surface.

1. Reorder: once `registrationExists`, `StaffDocuments` and
   `StaffConsentCheckbox` render **above** the `บันทึก` button. Nothing required
   sits below the CTA.
2. `RegistrationPendingNotice` becomes floor-aware. Below the floor it renders
   the incomplete variant — heading `ยังส่งไม่ครบ` — listing only the items still
   outstanding, each a tap-to-jump anchor to its control. At or above the floor
   it renders today's `ส่งใบสมัครแล้ว รอการอนุมัติ` copy unchanged.
3. Rewrite the anti-phishing line so it cannot read as "no card needed":
   `อย่าส่งบัตรให้คนอื่น — อัปโหลดในแอปนี้เท่านั้น`.
4. Drop the `&& !consentedAt` conjunct on the floor hint so it survives partial
   completion.
5. While the floor is unmet the primary action names the next step **and
   performs it**: the label is `บันทึกและไปขั้นต่อไป`, and on a successful save
   the view scrolls to the first outstanding control. Once the floor is met the
   label reverts to `บันทึก` and the scroll does not fire. A label that named a
   next step without moving the user there would be the same class of defect as
   D1 — copy asserting something the screen does not do.

The floor list is derived from the existing `registrationApprovalFloor` —
`bankExempt` already suppresses the two bank items, so a firm member is never
told to produce a passbook. No new floor logic.

**Negative cases**

| mode | Thai string | recovery |
| --- | --- | --- |
| Upload fails (network/storage) | `อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` (existing) | Retry in place; the item stays listed as outstanding, so the state cannot silently read as done. |
| Consent RPC rejects — registration no longer pending (approved/rejected between render and tap) | `ใบสมัครนี้ไม่อยู่ระหว่างพิจารณาแล้ว กรุณารีเฟรชหน้านี้` | Refresh; the workspace re-renders in its real status. Self-heals on reload. |
| Floor met by another device/tab, this tab still shows `ยังส่งไม่ครบ` | none — stale render, no error | `router.refresh()` already runs after every save; a manual reopen also corrects it. No new handling. |
| Zero items outstanding but status still `pending` | the existing submitted/awaiting copy | None needed — this is the correct terminal applicant state. |

New strings used on 2+ surfaces (the notice and the hint) go to
`src/lib/i18n/labels.ts`.

**RED-first tests**

- Below floor → notice renders `ยังส่งไม่ครบ` and does **not** contain
  `ส่งใบสมัครแล้ว`; at floor → the inverse. Pin **both** directions.
- Consent given + id_card missing → the outstanding-items line is **present**
  (the D3 regression pin; today it is absent).
- `bankExempt` → the outstanding list never names สมุดบัญชีธนาคาร.
- DOM order assert: both document and consent controls precede the primary
  button in the rendered tree.
- Mutation-check every one of the above: break the production change by hand,
  confirm RED, restore. Commit before mutating — `git checkout --` restores to
  HEAD, not to the working tree.

### U2 — เตรียมตัว prep screen

Renders where the blank form renders today, for a visitor with no registration.
Dismissed by its CTA in client state.

- สิ่งที่ต้องเตรียม: บัตรประชาชน (ถ่ายรูปได้เลย); สมุดบัญชีธนาคาร **only** when
  not `subconFresh`
- ใช้เวลาประมาณ 2 นาที
- notes that a PDPA consent step follows
- one primary CTA → the form

**It is a state, not a route.** A separate page would have to carry
`?project&site&by&contractor&firm` across another hop and re-validate at each
one — exactly the bug class #677 fixed, where the login round-trip dropped every
QR param and produced 0-of-18 attribution. Not reopened for one screen.

`subconFresh` derives from the advisory `?contractor` param. Acceptable here:
the screen gives advice and binds nothing, the same trust posture as the
existing `?site` and `?firm` display labels.

**Negative cases**

| mode | Thai string | recovery |
| --- | --- | --- |
| No `?contractor` (organic/PRC applicant) | none — renders the PRC variant including สมุดบัญชีธนาคาร | Correct default; the approver's confirmed firm is the only binding either way. |
| Forged/malformed `?contractor` uuid | none — treated as absent, PRC variant renders | Self-heals: the RPC coerces an unknown firm to NULL and the DB floors backstop. |
| Applicant already has a registration | prep screen never renders | Returning applicants land on the workspace via `comingSoonDecision`. |

**RED-first tests:** prep renders only when no registration exists; passbook line
present/absent by `subconFresh`, both directions; CTA reveals the form.

### U3 — tell them before they scan

Add a prepare line to `/team/poster` and the LINE share text, which today say
only `สแกนด้วยมือถือของท่านเพื่อสมัครเข้าทีม`:
`เตรียมบัตรประชาชนก่อนสแกน`. Cheapest surface of the three and the only one that
reaches someone before their phone is out.

**Negative cases:** none — static copy. Test: poster renders the line; the share
URL still encodes correctly with it appended.

## 5. Verification

Per unit gate 4, tests green is not "works":

- Drive the real flow logged **out** — a new applicant is always logged out at
  first scan, and that is the leg #677 proved is easy to skip. A visitor created
  already-logged-in does not exercise it.
- Fill-rate re-read one week after U1 ships:
  `select count(*) filter (where has_id_card), count(*) filter (where has_consent) …`
  over registrations created **after** the release. Below-floor pending rows
  approaching zero is the success signal. If drop-off survives a page that no
  longer lies, the nudge surface (SA ค้างเอกสาร chip + LINE reminder) becomes the
  next unit — and only then is the office-proxy question worth reopening.

## 6. Rollout

⚠ **Ship U1 before the ช่างอวย pilot proceeds.** 19 people are queued to walk
this path; running them through the current page produces 19 stuck rows and
spends the firms' first impression of the app.

The four already-stuck applicants still have to reopen the app themselves —
nothing here reaches out to them. What changes is that when they do, the page
shows what it actually wants instead of the `รอการอนุมัติ` that has held
จารุวัฒน์ and ณัฐวุฒิ for fourteen days.
