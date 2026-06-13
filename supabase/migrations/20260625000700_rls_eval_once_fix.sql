-- Data-architecture hardening (rank 3, corrective) — fixes two problems in the
-- first eval-once pass (20260625000600):
--
-- (A) photo_markups broke with 42P17 infinite recursion. Its INSERT policy has
-- an INLINE self-referential subquery (the own-tombstone-target check reads
-- photo_markups). Wrapping auth.uid() inside that self-reference makes Postgres
-- flag the policy application as recursive. (Attachments avoid this by routing
-- the equivalent check through the SECURITY DEFINER helper
-- pr_attachment_tombstone_target_ok — no inline self-reference.) Restore the
-- ORIGINAL bare-call policy verbatim (20260620000200). photo_markups is
-- low-volume (photo annotations), so it is the single table excluded from
-- eval-once; converting it to a SECURITY DEFINER tombstone helper later would
-- let it join the optimization.
--
-- (B) The first pass looped a LIVE cursor over pg_policies while issuing ALTER
-- POLICY, so the catalog changed under the cursor and only 34 of ~67 policies
-- were wrapped. Snapshot the target rows into a temp table FIRST, then alter, so
-- every remaining bare policy is covered. photo_markups excluded (see A).

-- (A) Restore photo_markups INSERT policy to its working (bare) form.
drop policy "photo_markups insert content or own tombstone" on public.photo_markups;
create policy "photo_markups insert content or own tombstone"
  on public.photo_markups for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and created_by = auth.uid()
    and exists (select 1 from public.photo_logs pl
                where pl.id = photo_log_id)
    and (superseded_by is null
         or exists (select 1 from public.photo_markups target
                    where target.id = photo_markups.superseded_by
                      and target.photo_log_id = photo_markups.photo_log_id
                      and target.superseded_by is null
                      and target.created_by = auth.uid()))
  );

-- (B) Complete the wrap over the policies the cursor skipped.
do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql   text;
  v_count integer := 0;
begin
  create temp table _pol_rewrite on commit drop as
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and tablename <> 'photo_markups'
       and (
         (qual ~ 'current_user_role\(\)|auth\.uid\(\)'
            and qual !~ 'select current_user_role|select auth\.uid')
         or (with_check ~ 'current_user_role\(\)|auth\.uid\(\)'
            and with_check !~ 'select current_user_role|select auth\.uid')
       );

  for r in select * from _pol_rewrite loop
    v_using := r.qual;
    v_check := r.with_check;
    if v_using is not null then
      v_using := regexp_replace(v_using, 'current_user_role\(\)',
                                '(select current_user_role())', 'g');
      v_using := regexp_replace(v_using, 'auth\.uid\(\)',
                                '(select auth.uid())', 'g');
    end if;
    if v_check is not null then
      v_check := regexp_replace(v_check, 'current_user_role\(\)',
                                '(select current_user_role())', 'g');
      v_check := regexp_replace(v_check, 'auth\.uid\(\)',
                                '(select auth.uid())', 'g');
    end if;

    v_sql := format('alter policy %I on public.%I', r.policyname, r.tablename);
    if v_using is not null then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice 'rls_eval_once_fix: wrapped % additional policies', v_count;
end;
$$;
