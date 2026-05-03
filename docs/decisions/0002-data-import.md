# ADR 0002: WP Data Import Strategy

Date: 2026-05-03  
Status: Accepted

## Context

Work Package (WP) data originates from estimators and project managers in spreadsheet form. We need a reliable, validated path into the Postgres database without risking partial or corrupted imports.

## Decision

### Manual Import Flow

1. Admin downloads a CSV or XLSX template from the admin panel.
2. Admin (or estimator) fills the template offline.
3. Admin uploads the completed file to the `/admin/import` endpoint.
4. The server validates the entire file against strict schema rules before writing anything.
5. On success, all rows are written in a single transaction.
6. On any validation failure, the **entire file is rejected** and an error report is returned listing every failing row and field.

### No Automated Sync

- There is **no automated Google Sheets sync in v1**.
- All imports are manual and admin-initiated.
- Direct form entry by admin is also supported as an alternative to file upload.

## Consequences

- Partial imports are explicitly disallowed. This prevents orphaned or inconsistent records at the cost of requiring re-upload on failure.
- Admins receive a clear error report, so fixing issues before re-upload is straightforward.
- gSheet sync can be added in v2 once the schema is stable and the manual flow has been validated in production.
