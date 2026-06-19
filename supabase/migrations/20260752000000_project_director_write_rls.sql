-- Spec 152 U3 / ADR 0058 — project_director table write (and master-read) RLS.
--
-- Final unit: add project_director to every RLS policy whose role list literally
-- names project_manager, so a director acts as a see-all PM on the direct-table
-- paths too (notably APPROVALS insert — approving a WP is a direct RLS insert,
-- not an RPC — plus deliverables/reports/work_packages/photo_logs/members/
-- purchase_* writes and the master-table reads: clients/contractors/suppliers/
-- equipment/workers/service_providers).
--
-- The project-scoped SELECT policies are NOT here: they gate on can_see_project
-- (see-all for director since U1), so they never name project_manager literally.
-- Operator-only (super_admin-alone) policies never name project_manager either,
-- so they are untouched.
--
-- Policies are reconstructed from the LIVE catalog (pg_policies) with
-- project_director appended to each role ARRAY — DROP + CREATE (Postgres has no
-- CREATE OR REPLACE POLICY). `48` policies, 58 role lists widened.

drop policy "approvals insert by pm/super" on public.approvals;
create policy "approvals insert by pm/super"
  on public.approvals
  as permissive
  for insert
  to public
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_wp(approvals.work_package_id) AS can_see_wp)));

drop policy "clients insert by pm or super_admin" on public.clients;
create policy "clients insert by pm or super_admin"
  on public.clients
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

drop policy "clients readable by staff" on public.clients;
create policy "clients readable by staff"
  on public.clients
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "clients update by pm or super_admin" on public.clients;
create policy "clients update by pm or super_admin"
  on public.clients
  as permissive
  for update
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "bank change requests readable by staff" on public.contractor_bank_change_requests;
create policy "bank change requests readable by staff"
  on public.contractor_bank_change_requests
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "contractor_consents readable by staff" on public.contractor_consents;
create policy "contractor_consents readable by staff"
  on public.contractor_consents
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "contractor_invites readable by staff" on public.contractor_invites;
create policy "contractor_invites readable by staff"
  on public.contractor_invites
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "contractor_users readable by staff or self" on public.contractor_users;
create policy "contractor_users readable by staff or self"
  on public.contractor_users
  as permissive
  for select
  to authenticated
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) OR (user_id = ( SELECT auth.uid() AS uid))));

drop policy "contractors insert by staff" on public.contractors;
create policy "contractors insert by staff"
  on public.contractors
  as permissive
  for insert
  to authenticated
  with check (((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid))));

drop policy "contractors readable by privileged roles" on public.contractors;
create policy "contractors readable by privileged roles"
  on public.contractors
  as permissive
  for select
  to authenticated
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "contractors update by staff" on public.contractors;
create policy "contractors update by staff"
  on public.contractors
  as permissive
  for update
  to authenticated
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "deliverables insert by pm or super_admin" on public.deliverables;
create policy "deliverables insert by pm or super_admin"
  on public.deliverables
  as permissive
  for insert
  to public
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_project(deliverables.project_id) AS can_see_project)));

drop policy "deliverables update by pm or super_admin" on public.deliverables;
create policy "deliverables update by pm or super_admin"
  on public.deliverables
  as permissive
  for update
  to public
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_project(deliverables.project_id) AS can_see_project)))
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_project(deliverables.project_id) AS can_see_project)));

drop policy "equipment_categories insert by back office" on public.equipment_categories;
create policy "equipment_categories insert by back office"
  on public.equipment_categories
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

drop policy "equipment_categories readable by staff" on public.equipment_categories;
create policy "equipment_categories readable by staff"
  on public.equipment_categories
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "equipment_categories update by back office" on public.equipment_categories;
create policy "equipment_categories update by back office"
  on public.equipment_categories
  as permissive
  for update
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "equipment_items insert by back office" on public.equipment_items;
create policy "equipment_items insert by back office"
  on public.equipment_items
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

drop policy "equipment_items readable by staff" on public.equipment_items;
create policy "equipment_items readable by staff"
  on public.equipment_items
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "equipment_items update by back office" on public.equipment_items;
create policy "equipment_items update by back office"
  on public.equipment_items
  as permissive
  for update
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "equipment_movements insert by staff" on public.equipment_movements;
create policy "equipment_movements insert by staff"
  on public.equipment_movements
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

drop policy "equipment_movements readable by staff" on public.equipment_movements;
create policy "equipment_movements readable by staff"
  on public.equipment_movements
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "equipment_owners insert by back office" on public.equipment_owners;
create policy "equipment_owners insert by back office"
  on public.equipment_owners
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

drop policy "equipment_owners readable by staff" on public.equipment_owners;
create policy "equipment_owners readable by staff"
  on public.equipment_owners
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "equipment_owners update by back office" on public.equipment_owners;
create policy "equipment_owners update by back office"
  on public.equipment_owners
  as permissive
  for update
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "photo_logs insert by sa/pm/super" on public.photo_logs;
create policy "photo_logs insert by sa/pm/super"
  on public.photo_logs
  as permissive
  for insert
  to public
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_wp(photo_logs.work_package_id) AS can_see_wp)));

drop policy "photo_markups insert content or own tombstone" on public.photo_markups;
create policy "photo_markups insert content or own tombstone"
  on public.photo_markups
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM photo_logs pl
  WHERE (pl.id = photo_markups.photo_log_id))) AND ((superseded_by IS NULL) OR ( SELECT photo_markup_tombstone_target_ok(photo_markups.superseded_by, photo_markups.photo_log_id) AS photo_markup_tombstone_target_ok)) AND ( SELECT can_see_photo_log(photo_markups.photo_log_id) AS can_see_photo_log)));

drop policy "project members delete by pm or super_admin" on public.project_members;
create policy "project members delete by pm or super_admin"
  on public.project_members
  as permissive
  for delete
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "project members insert by pm or super_admin" on public.project_members;
create policy "project members insert by pm or super_admin"
  on public.project_members
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (added_by = ( SELECT auth.uid() AS uid))));

drop policy "project members readable by staff" on public.project_members;
create policy "project members readable by staff"
  on public.project_members
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "insert source document by back office" on public.purchase_order_attachments;
create policy "insert source document by back office"
  on public.purchase_order_attachments
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid)) AND (superseded_by IS NULL) AND (EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE (po.id = purchase_order_attachments.purchase_order_id)))));

drop policy "purchase_order_deliveries readable by back office" on public.purchase_order_deliveries;
create policy "purchase_order_deliveries readable by back office"
  on public.purchase_order_deliveries
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "purchase_orders readable by back office" on public.purchase_orders;
create policy "purchase_orders readable by back office"
  on public.purchase_orders
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "insert reference while pending or confirmation when delivered" on public.purchase_request_attachments;
create policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments
  as permissive
  for insert
  to authenticated
  with check (((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (((purpose = 'reference'::purchase_request_attachment_purpose) AND (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.requested_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (pr.status = 'requested'::purchase_request_status))))) OR ((purpose = 'delivery_confirmation'::purchase_request_attachment_purpose) AND (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.status = ANY (ARRAY['on_route'::purchase_request_status, 'delivered'::purchase_request_status])))))) OR ((purpose = 'invoice'::purchase_request_attachment_purpose) AND (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.status = ANY (ARRAY['purchased'::purchase_request_status, 'on_route'::purchase_request_status, 'delivered'::purchase_request_status, 'site_purchased'::purchase_request_status]))))))) AND ((superseded_by IS NULL) OR pr_attachment_tombstone_target_ok(superseded_by, purchase_request_id, ( SELECT ( SELECT auth.uid() AS uid) AS uid)))));

drop policy "purchase_requests insert by wp-readers" on public.purchase_requests;
create policy "purchase_requests insert by wp-readers"
  on public.purchase_requests
  as permissive
  for insert
  to public
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (requested_by = ( SELECT auth.uid() AS uid)) AND (source = 'app'::text) AND ( SELECT can_see_wp(purchase_requests.work_package_id) AS can_see_wp)));

drop policy "purchase_requests update by pm or super" on public.purchase_requests;
create policy "purchase_requests update by pm or super"
  on public.purchase_requests
  as permissive
  for update
  to public
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "reports insert by pm or super_admin" on public.reports;
create policy "reports insert by pm or super_admin"
  on public.reports
  as permissive
  for insert
  to public
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_project(reports.project_id) AS can_see_project)));

drop policy "service_providers insert by pm or super_admin" on public.service_providers;
create policy "service_providers insert by pm or super_admin"
  on public.service_providers
  as permissive
  for insert
  to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

drop policy "service_providers readable by staff" on public.service_providers;
create policy "service_providers readable by staff"
  on public.service_providers
  as permissive
  for select
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "service_providers update by pm or super_admin" on public.service_providers;
create policy "service_providers update by pm or super_admin"
  on public.service_providers
  as permissive
  for update
  to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "suppliers insert by back office" on public.suppliers;
create policy "suppliers insert by back office"
  on public.suppliers
  as permissive
  for insert
  to authenticated
  with check (((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid))));

drop policy "suppliers readable by staff" on public.suppliers;
create policy "suppliers readable by staff"
  on public.suppliers
  as permissive
  for select
  to authenticated
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "suppliers update by back office" on public.suppliers;
create policy "suppliers update by back office"
  on public.suppliers
  as permissive
  for update
  to authenticated
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "members delete by pm or super_admin" on public.work_package_members;
create policy "members delete by pm or super_admin"
  on public.work_package_members
  as permissive
  for delete
  to authenticated
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "members insert by pm or super_admin" on public.work_package_members;
create policy "members insert by pm or super_admin"
  on public.work_package_members
  as permissive
  for insert
  to authenticated
  with check (((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (added_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid))));

drop policy "members readable by privileged roles" on public.work_package_members;
create policy "members readable by privileged roles"
  on public.work_package_members
  as permissive
  for select
  to authenticated
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "work_packages insert by pm or super_admin" on public.work_packages;
create policy "work_packages insert by pm or super_admin"
  on public.work_packages
  as permissive
  for insert
  to public
  with check ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

drop policy "work_packages update by pm or super_admin" on public.work_packages;
create policy "work_packages update by pm or super_admin"
  on public.work_packages
  as permissive
  for update
  to public
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_project(work_packages.project_id) AS can_see_project)))
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND ( SELECT can_see_project(work_packages.project_id) AS can_see_project)));

drop policy "workers readable by staff" on public.workers;
create policy "workers readable by staff"
  on public.workers
  as permissive
  for select
  to authenticated
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));
