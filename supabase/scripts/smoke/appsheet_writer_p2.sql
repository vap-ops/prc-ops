-- ==========================================================================
-- TIER-2 SMOKE: appsheet_writer role — out-of-band verification ritual
-- ==========================================================================
-- WHEN: After the operator sets the appsheet_writer password
--       (docs/go-live-checklist.md § 2a Step 1).
--       Re-run after any password rotation or role-touching migration.
-- WHO:  Operator, connected as appsheet_writer over the Session Pooler.
--
-- CONNECTION (Session Pooler — NOT Transaction Pooler; session mode required
-- for DO blocks and explicit ROLLBACK):
--
--   psql "postgres://appsheet_writer:<password>@<session-pooler-host>:5432/<db-name>"
--
-- The Session Pooler host and db-name are in Supabase → Project Settings →
-- Database → Connection string → Session pooler (port 5432).
--
-- SAFETY: the entire script is wrapped in BEGIN … ROLLBACK.
-- Every UPDATE and trigger write rolls back; production data is unchanged.
--
-- EXPECTED OUTPUT = PASS: every labelled line in the psql output should
-- read [PASS]. Any [FAIL] line requires investigation before sign-off.
-- [MANUAL][2b] is informational — see the Tier-2b section at the bottom.
--
-- WHAT THIS PROVES (what pgTAP cannot — see ADR 0025 § Testing note):
--   [1]  RLS row-visibility: only approved/purchased/delivered rows visible.
--   [2a] Purchase transition fires under a real appsheet_writer session.
--   [3a] UPDATE status        → 42501.
--   [3b] UPDATE item_description → 42501.
--   [3c] INSERT               → 42501.
-- Audit principal (payload->>'principal' = 'appsheet_writer') requires a
-- super_admin session to read audit_log; see Tier-2b at the end.
-- ==========================================================================

begin;

-- --------------------------------------------------------------------------
-- PRE-FLIGHT: confirm we are running as appsheet_writer.
-- --------------------------------------------------------------------------
do $$
begin
  if current_user <> 'appsheet_writer' then
    raise warning
      'WARN: running as %, not appsheet_writer — results do not prove '
      'the appsheet_writer privilege set', current_user;
  end if;
  raise notice 'PRE-FLIGHT: session_user = %, current_user = %',
               session_user, current_user;
end;
$$;

-- --------------------------------------------------------------------------
-- SETUP — locate an approved PR to use as the target row.
-- --------------------------------------------------------------------------
-- Uses set_config (transaction-local, rolled back with the txn) to pass
-- the target id between DO blocks without a temp table.
-- --------------------------------------------------------------------------
do $$
declare
  v_id    uuid;
  v_total bigint;
begin
  select id into v_id
    from public.purchase_requests
   where status = 'approved'
   limit 1;

  if v_id is null then
    raise exception
      'SETUP FAILED: no approved purchase_requests row found. '
      'Create and approve at least one requisition via the native app, '
      'then re-run this script.';
  end if;

  select count(*) into v_total from public.purchase_requests;

  perform set_config('smoke.target_id', v_id::text, true);

  raise notice 'SETUP: target_id = % (% total rows visible)', v_id, v_total;
end;
$$;

-- --------------------------------------------------------------------------
-- [1] Row-visibility gate
-- --------------------------------------------------------------------------
-- The appsheet_writer SELECT policy restricts to
--   status IN ('approved', 'purchased', 'delivered').
-- 'requested' and 'rejected' rows must be invisible.
-- This is the RLS effect that pgTAP cannot test (pgTAP runs as postgres,
-- which has BYPASSRLS and sees everything).
--
-- NOTE: if v_visible = 0 this check is inconclusive — there may simply be
-- no rows at all in the allowed set. The SETUP block above would have
-- already failed in that case (no approved row found), so reaching here
-- means v_visible >= 1.
-- --------------------------------------------------------------------------
do $$
declare
  v_leaked  int;
  v_visible int;
begin
  select count(*)::int into v_leaked
    from public.purchase_requests
   where status::text in ('requested', 'rejected');

  select count(*)::int into v_visible
    from public.purchase_requests
   where status::text in ('approved', 'purchased', 'delivered');

  if v_leaked = 0 then
    raise notice '[PASS][1] Row-visibility: 0 requested/rejected rows visible; % row(s) in allowed set',
                 v_visible;
  else
    raise notice '[FAIL][1] Row-visibility: % requested/rejected row(s) leaked — RLS policy misconfigured',
                 v_leaked;
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- [2a] Purchase transition: approved → purchased
-- --------------------------------------------------------------------------
-- UPDATE the target row with the four purchase fact columns.
-- The BEFORE trigger (purchase_requests_derive_appsheet_status) must advance
-- status to 'purchased'. A re-SELECT confirms the derived value.
--
-- The AFTER trigger (purchase_requests_audit_appsheet) also fires and writes
-- an audit_log row with principal = session_user. That row is inside this
-- rolled-back transaction, so it will not persist. The principal assertion
-- requires a committed row visible to super_admin — see Tier-2b below.
-- --------------------------------------------------------------------------
do $$
declare
  v_id         uuid;
  v_new_status text;
begin
  v_id := current_setting('smoke.target_id')::uuid;

  update public.purchase_requests
     set supplier     = 'SMOKE-SUPPLIER',
         order_ref    = 'SMOKE-001',
         amount       = 1.00,
         purchased_at = now()
   where id = v_id;

  select status::text into v_new_status
    from public.purchase_requests
   where id = v_id;

  if v_new_status = 'purchased' then
    raise notice '[PASS][2a] Purchase transition: status = ''purchased'' for row %', v_id;
  else
    raise notice '[FAIL][2a] Purchase transition: status = ''%'', expected ''purchased'' — trigger may be broken',
                 coalesce(v_new_status, 'NULL (row not found)');
  end if;

  -- Audit-principal check must be done out-of-band — appsheet_writer has no
  -- SELECT on audit_log (ADR 0025 Decision C; audit_log grant is to
  -- authenticated only). See Tier-2b at the bottom of this script.
  raise notice '[MANUAL][2b] Audit principal: appsheet_writer has no SELECT on audit_log.'
               ' Verify payload->>''principal'' = ''appsheet_writer'' via Tier-2b'
               ' (end of this script). Row id for reference: %', v_id;
end;
$$;

-- --------------------------------------------------------------------------
-- [3a] 42501: UPDATE status column denied
-- --------------------------------------------------------------------------
-- appsheet_writer's UPDATE grant is column-scoped to the 7 fact columns only.
-- Status is explicitly excluded (Decision A of ADR 0025: privilege-layer
-- guarantee that AppSheet cannot directly write 'approved', 'rejected', etc.).
-- --------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  v_id := current_setting('smoke.target_id')::uuid;
  begin
    -- Row is now 'purchased' (from check 2a). Attempting to set it back
    -- to 'approved' must raise 42501 — status has no UPDATE grant.
    update public.purchase_requests set status = 'approved' where id = v_id;
    raise notice '[FAIL][3a] UPDATE status: succeeded — column grant is broader than expected';
  exception
    when insufficient_privilege then
      raise notice '[PASS][3a] UPDATE status: denied (42501 insufficient_privilege)';
    when others then
      raise notice '[FAIL][3a] UPDATE status: unexpected error % — %', sqlstate, sqlerrm;
  end;
end;
$$;

-- --------------------------------------------------------------------------
-- [3b] 42501: UPDATE item_description denied
-- --------------------------------------------------------------------------
-- item_description is a requisition-definition column, not a P2 fact column.
-- It is not in the column-scoped UPDATE grant; write attempts must fail.
-- --------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  v_id := current_setting('smoke.target_id')::uuid;
  begin
    update public.purchase_requests set item_description = 'tampered' where id = v_id;
    raise notice '[FAIL][3b] UPDATE item_description: succeeded — column grant is broader than expected';
  exception
    when insufficient_privilege then
      raise notice '[PASS][3b] UPDATE item_description: denied (42501 insufficient_privilege)';
    when others then
      raise notice '[FAIL][3b] UPDATE item_description: unexpected error % — %', sqlstate, sqlerrm;
  end;
end;
$$;

-- --------------------------------------------------------------------------
-- [3c] 42501: INSERT denied
-- --------------------------------------------------------------------------
-- INSERT is deferred (Decision B of ADR 0025); no INSERT grant or INSERT
-- policy exists for appsheet_writer. The FK violation on work_package_id
-- would also fire eventually, but the 42501 fires first.
-- --------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.purchase_requests
      (work_package_id, item_description, quantity, unit)
    values
      (gen_random_uuid(), 'smoke-insert-test', 1, 'item');
    raise notice '[FAIL][3c] INSERT: succeeded — table-level insert grant exists unexpectedly';
  exception
    when insufficient_privilege then
      raise notice '[PASS][3c] INSERT: denied (42501 insufficient_privilege)';
    when others then
      raise notice '[FAIL][3c] INSERT: unexpected error % — %', sqlstate, sqlerrm;
  end;
end;
$$;

rollback;

-- ==========================================================================
-- TIER-2b: AUDIT PRINCIPAL VERIFICATION (manual — run once as super_admin)
-- ==========================================================================
-- appsheet_writer has no SELECT on audit_log (ADR 0025 Decision C), so the
-- critical assertion
--
--   payload->>'principal' = 'appsheet_writer'
--
-- cannot be made from within this script. Run the steps below after the
-- Tier-2 script above passes all checks.
--
-- WHY THIS MATTERS: the SECURITY DEFINER audit trigger captures session_user,
-- not current_user. Under SECURITY DEFINER, current_user = function owner
-- (postgres). If the trigger ever captured current_user instead of
-- session_user, every audit row would silently read 'postgres' — a forensic
-- failure invisible to pgTAP. This step is the only way to prove the correct
-- variable is used under a real appsheet_writer session.
-- ==========================================================================
--
-- STEP 1 — Create a dedicated throwaway requisition and commit the purchase.
--
--   DO NOT use an existing approved row — smoke data must never be committed
--   onto a real pilot requisition.
--
--   a. Log in to the native app as a project_manager (or site_admin, depending
--      on who can create requisitions in the pilot).
--   b. Create a new purchase requisition with:
--        item_description = 'SMOKE TEST — appsheet_writer principal check — safe to leave'
--      (any work_package, quantity, and unit are fine).
--   c. As a project_manager, approve it through the native PM review flow.
--   d. Retrieve its id (run as super_admin in the SQL editor):
--
--        SELECT id, item_description, status
--          FROM public.purchase_requests
--         WHERE item_description LIKE 'SMOKE TEST%'
--         ORDER BY requested_at DESC
--         LIMIT 1;
--
--   e. As appsheet_writer in psql, commit the purchase (no BEGIN/ROLLBACK):
--
--        UPDATE public.purchase_requests
--           SET supplier     = 'SMOKE-SUPPLIER',
--               order_ref    = 'SMOKE-001',
--               amount       = 1.00,
--               purchased_at = now()
--         WHERE id = '<throwaway-id>';
--
-- STEP 2 — Verify the audit row (as super_admin in the Supabase SQL editor):
--
--     SELECT action,
--            actor_id,
--            actor_role,
--            payload->>'principal' AS principal
--       FROM public.audit_log
--      WHERE target_id = '<throwaway-id>'::uuid
--        AND action    = 'purchase_request_purchase'
--      ORDER BY created_at DESC
--      LIMIT 1;
--
--   EXPECTED RESULT:
--     action                    | actor_id | actor_role | principal
--     --------------------------+----------+------------+-----------------
--     purchase_request_purchase | NULL     | NULL       | appsheet_writer
--
--   If principal = 'postgres': the trigger is capturing current_user instead
--   of session_user. Raise as a defect — the audit forensics are wrong.
--   If no row is returned: the AFTER trigger did not fire. Verify that
--   STEP 1e advanced status to 'purchased' (the UPDATE must have made a
--   null→non-null transition on purchased_at from an 'approved' row).
--
-- NO RESET — leave the throwaway requisition in its 'purchased' state.
--
--   The row is self-identifying test data (item_description begins with
--   'SMOKE TEST'). The audit_log row written in STEP 1e is correct and
--   append-only; reversing it is not possible or desirable.
--
--   Do NOT reset the purchase_requests row with an ad-hoc SQL-editor UPDATE:
--   that violates change-management.md §1 (direct dashboard mutation outside
--   the normal write path) and would write a spurious 'update' audit row.
--   If the row must be removed later (e.g. it appears in a pilot report),
--   use the controlled service-role path from §1 of go-live-checklist.md,
--   with its own audit_log entry documenting the removal.
-- ==========================================================================
