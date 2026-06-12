-- Spec 48 — requester notes on purchase requests.
--
-- Free-text note set by the requester at creation ("brand X", "deliver
-- after 2pm", a message to procurement). Write-once by posture: the
-- note is part of the request the PM decides on, so authenticated gets
-- the INSERT privilege only — no UPDATE grant (spec 33 / ADR 0038
-- column-scope doctrine). appsheet_writer gets nothing (ADR 0034
-- column freeze). Length is app-validated (<= 1000); no DB CHECK,
-- consistent with the item_description/unit posture (spec 36 — DB
-- CHECKs for all three are one queued follow-up).
--
-- RLS is untouched: the INSERT policy's requester-pin and the
-- site-wide SELECT (ADR 0026) already cover the column.

alter table public.purchase_requests
  add column notes text;

comment on column public.purchase_requests.notes is
  'Requester free-text note, write-once at creation (spec 48). App-validated <= 1000 chars.';

grant insert (notes) on public.purchase_requests to authenticated;
