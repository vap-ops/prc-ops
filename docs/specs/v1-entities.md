# v1 Database Entities

The five tables that will be deployed for the v1 pilot.

## projects

Represents a construction project. The top-level grouping for all work packages, photos, and approvals.

Key fields: `id`, `name`, `status` (Postgres enum), `created_at`, `created_by`.

## work_packages

A unit of work within a project. Photos are attached to work packages. PMs approve at the work package level.

Key fields: `id`, `project_id` (FK → projects), `name`, `status` (Postgres enum), `created_at`.

## photo_logs

An append-only log of photos uploaded against a work package. Logical edits use the supersede pattern (`superseded_by` FK → photo_logs).

Key fields: `id`, `work_package_id` (FK → work_packages), `storage_path`, `exif_captured_at`, `uploaded_by` (FK → users), `uploaded_at`, `superseded_by` (FK → photo_logs, nullable).

## users

Application users synced from Supabase Auth. Stores role and LINE identity linkage.

Key fields: `id` (matches Supabase Auth UID), `display_name`, `role` (Postgres enum: `site_admin` | `pm`), `line_user_id`, `created_at`.

## audit_log

Append-only event log. Records every status change, photo upload, approval, and import. Never updated or deleted.

Key fields: `id`, `event_type` (Postgres enum), `actor_id` (FK → users), `target_table`, `target_id`, `payload` (JSONB), `occurred_at`.
