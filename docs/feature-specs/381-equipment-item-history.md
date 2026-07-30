# Spec 381 — Per-item equipment log history (ประวัติอุปกรณ์)

**Status:** draft · **Origin:** operator, 2026-07-30, verbatim: _"Each item needs a
log history"_ (fourth of four follow-ups to the spec-367 registry reset).
**Related:** [367](367-equipment-registry-completeness.md) (registry completeness,
the PRI transfer) · [368](368-store-equipment-section.md) (store view) ·
[370](370-equipment-scan.md) (scan borrow/return) · ADR 0004 (append-only) ·
ADR 0055 decision 6 (the equipment money wall).

---

## 1. Why now

The registry was wiped and re-created by hand on 2026-07-30 (spec 367 reset, mig
`20260813075882`). **Every item in it is younger than this spec.** If the trail
starts now, the fleet has a complete history from birth — the one moment where
that is free. It stops being free the day the operator finishes typing.

It also carries weight beyond curiosity: spec 367 §3 sells the whole fleet to PRI
and rents it back. A transfer schedule is a claim about assets, and "when did this
machine arrive, where has it been, what did it cost to rent" is the evidence
behind it.

## 2. Live grounding (checked 2026-07-30, not remembered)

| Source                                                                           | Rows                                             | Carries                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `equipment_movements`                                                            | 0 (was 64, all `deployed`, deleted by the reset) | kind · project · qty · note · `occurred_at` · `created_by`. **Append-only**, trigger-enforced.                                                             |
| `equipment_usage_logs`                                                           | **0 ever**                                       | borrow/return + condition photos (`equipment_usage_photos`). RPC-only writes; `daily_rate_snapshot` is column-walled.                                      |
| `audit_log` where `target_table='equipment_items'`                               | 65                                               | 64 × `equipment_rate_change` + 1 × the reset.                                                                                                              |
| **Plain edits** — name, category, owner, status, tracking, asset_tag, image_path | **nothing**                                      | ⚠️ These are unaudited `UPDATE`s. **Renaming an item, moving it to another owner, or flipping its status leaves NO trace today.** This is the actual hole. |

## 3. The two findings that shape the design

### 3.1 `audit_log` is unreadable by the people who own equipment

Live policy, both arms:

- `audit_log select internal privileged` → `super_admin`, `project_director`,
  `accounting`, `project_manager` only.
- `audit_log select wp rework events` → `site_admin`, `procurement`,
  `procurement_manager`, **but only for `wp_reopened_for_defect` /
  `wp_evidence_resubmitted`**.

So `procurement` and `procurement_manager` — the roles that actually curate the
registry — **cannot read a single equipment audit row**, and neither can
`site_admin`, who is the one moving the tools around. A history built on a direct
`audit_log` select would render empty for exactly its audience.

**Decision D1: read through a `SECURITY DEFINER` RPC**, `equipment_item_history(p_item_id uuid)`,
with its own role gate — the house pattern (`wp_status_history`,
`item_price_history`, `get_actor_timeline` all exist). **Rejected:** adding an
equipment arm to the `audit_log` SELECT policy — it widens a security-sensitive
policy for a read that a definer function already scopes to one item.

### 3.2 A plain trigger cannot write the trail

`authenticated` holds **`SELECT` only** on `audit_log` — no INSERT grant, and no
INSERT policy. A trigger function runs as the invoking user, so an ordinary
`AFTER UPDATE` trigger inserting into `audit_log` would raise **42501 and abort
the user's edit**: editing an item would simply stop working.

**Decision D2: the trigger function is `SECURITY DEFINER`**, matching how
`set_equipment_daily_rate` already writes its audit rows. `search_path` pinned,
`revoke all … from public, anon` on the function.

## 4. Decisions

- **D3 — the trail lives in `audit_log`, not a new table.** It is the house
  append-only SSOT, it already holds this item's rate changes, and a second table
  would split one item's story across two retention stories. New action:
  `equipment_item_updated`, payload = the changed fields only (`{field: {from, to}}`),
  never the whole row.
- **D4 — MONEY IS GATED INSIDE THE RPC.** `equipment_rate_change` payloads carry
  `old_rate`/`new_rate`, and `daily_rate` has no `authenticated` grant at all
  (ADR 0055 d6). The RPC returns rate events **only** to the money audience
  (`BACK_OFFICE_ROLES`); for anyone else the rows are omitted entirely, not
  redacted — a visible "the rate changed" line still discloses that this asset is
  priced. Pinned in pgTAP in the negative direction.
- **D5 — audience.** Everything else (arrivals, deployments, returns, borrows,
  field edits) is visible to the whole `/equipment` audience, `EQUIPMENT_MOVE_ROLES`,
  because the `site_admin` moving the tool is the person most likely to ask where
  it went.
- **D6 — surface: its own sheet, not a section inside แก้ไข.** The edit sheet is a
  form; a growing log inside it pushes the save button off-screen and mixes reading
  with writing. `ประวัติ` becomes a third control in the row's existing cluster
  (ย้าย · แก้ไข · **ประวัติ**), opening a `BottomSheet`. There is no item detail page
  to hang it on, and inventing one is a bigger change than this asks for.
- **D7 — what a row shows:** Thai event label · when (Bangkok) · who · the detail
  that matters for that kind (project for a deployment, from→to for an edit,
  borrower for a loan). Newest first.

## 5. Units

| Unit   | Scope                                                                                                                                                                | Schema?                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **U1** | `SECURITY DEFINER` audit trigger on `equipment_items` (field-diff payload) + `equipment_item_history` RPC + grants + pgTAP (incl. the D4 money wall in the negative) | **yes** — one migration           |
| **U2** | `ประวัติ` sheet + the row door + Thai labels + empty state                                                                                                           | no                                |
| **U3** | Condition photos from `equipment_usage_logs` inline in the timeline (signed URLs)                                                                                    | no — deferred until borrows exist |

**Order matters:** U1 first and soon. Every item created before the trigger exists
has a permanently incomplete history, and the operator is typing the registry in
right now.

## 6. Acceptance — a fill-rate query, not a green suite

After U1 is live and the operator has edited a few items:

```sql
select action::text, count(*)
  from audit_log
 where target_table = 'equipment_items'
 group by 1 order by 2 desc;
```

`equipment_item_updated` must be **non-zero** after any real edit. Zero rows after
a week of curation means the trigger is not firing and the feature is dead on
arrival regardless of tests (the spec-328 fill-rate lesson).

## 7. Explicitly out of scope

- Editing or deleting a history entry (append-only; ADR 0004).
- History for `equipment_categories` / `equipment_owners` / rental batches.
- A cross-item activity feed — this is per item, opened from the item.
- Restoring the 128 rows deleted by the reset. They are gone by decision, and the
  audit row recording that deletion is itself the first entry in the fleet's story.

## 8. Risks

- **Bulk import noise.** The spec-367 U3b importer updates up to 64 rows in one
  submit; each becomes its own audit row. Accepted — that IS the history, and a
  per-row trail is what makes a bad import reviewable afterwards.
- **The trigger fires on every UPDATE**, including `image_path` writes from the
  image control. Also accepted: "photo replaced" is history.
- **Definer surface.** One more `SECURITY DEFINER` object on a money-adjacent
  table. Mitigated by D4's negative pgTAP pin and by scoping the RPC to a single
  item id.
