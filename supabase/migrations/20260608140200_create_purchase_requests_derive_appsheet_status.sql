-- Purchasing P2 — BEFORE UPDATE trigger that auto-advances status when
-- AppSheet sets a fact column that marks a lifecycle transition, and
-- raises on illegal moves.
--
-- Why a trigger instead of granting UPDATE on status:
--   Withholding the status column from appsheet_writer's UPDATE grant
--   makes "AppSheet cannot write requested/approved/rejected" a
--   privilege-layer guarantee, not a value-policing CHECK. The trigger
--   is the only path that can advance status for this role — if the
--   trigger is somehow bypassed, the privilege denial is a hard stop.
--   See Decision A in ADR 0025.
--
-- Transition logic:
--   approved  + purchased_at null→non-null  ⇒  status := 'purchased'
--   purchased + delivered_at null→non-null  ⇒  status := 'delivered'
--
-- Illegal moves (raise P0001):
--   delivered_at set while status <> 'purchased'  — must go purchased first.
--   purchased_at set while status not in ('approved','purchased') — catching
--     attempts to skip or re-set purchased_at on a non-approved row.
--
-- Corrections (no status transition, no error):
--   Any of the 7 granted columns is changed, but neither fact-column
--   null→non-null transition applies (e.g. amount edited on an already-
--   purchased row). Status is left unchanged.
--
-- Notes:
--   • The trigger fires BEFORE any row change, so new.status is writable.
--   • The trigger is owned by the migration owner (postgres / service role),
--     but it does NOT need to be SECURITY DEFINER — it reads and writes
--     the new row's own columns, no privilege escalation required.
--   • The P1b audit trigger (purchase_requests_audit_decision) fires AFTER
--     UPDATE when OLD.status = 'requested'. AppSheet touches rows whose
--     status is already 'approved' or 'purchased', so the WHEN clause is
--     never satisfied and there is no double-audit.

create function public.purchase_requests_derive_appsheet_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Illegal move guard: delivered_at on a non-purchased row.
  if new.delivered_at is not null and old.delivered_at is null
     and old.status <> 'purchased' then
    raise exception
      'purchase_requests: delivered_at may only be set when status is purchased (current: %)',
      old.status
      using errcode = 'P0001';
  end if;

  -- Illegal move guard: purchased_at set while status is not approved.
  -- (Also blocks re-setting purchased_at on an already-purchased row —
  -- a correction to purchased_at itself when already purchased is allowed
  -- because old.purchased_at is not null in that case.)
  if new.purchased_at is not null and old.purchased_at is null
     and old.status <> 'approved' then
    raise exception
      'purchase_requests: purchased_at may only be set when status is approved (current: %)',
      old.status
      using errcode = 'P0001';
  end if;

  -- Approved → purchased transition: purchased_at just became non-null.
  if old.status = 'approved' and new.purchased_at is not null and old.purchased_at is null then
    new.status := 'purchased';
    return new;
  end if;

  -- Purchased → delivered transition: delivered_at just became non-null.
  if old.status = 'purchased' and new.delivered_at is not null and old.delivered_at is null then
    new.status := 'delivered';
    return new;
  end if;

  -- Correction: no status advance, no error.
  return new;
end;
$$;

create trigger purchase_requests_derive_appsheet_status
  before update on public.purchase_requests
  for each row
  execute function public.purchase_requests_derive_appsheet_status();
