# data/

Templates and operator-staged files for the v1 importers. Real
project data is not checked in here — only templates.

## work-packages-template.csv

Three columns: `code`, `name`, `description`.

| Column        | Required | Notes                                                                    |
| ------------- | -------- | ------------------------------------------------------------------------ |
| `code`        | yes      | Unique within a project (composite key with the CLI's project argument). |
| `name`        | yes      | Free text. Thai characters supported (UTF-8).                            |
| `description` | no       | Optional. Leave the cell empty — do not write `N/A`.                     |

Unknown columns (e.g. `cost`, `subcon`, `qa` carried over from a
richer source sheet) are **ignored** — you do not need to strip them
before importing.

### File format

- **Encoding: UTF-8.** Non-UTF-8 input is rejected or garbled.
  - Excel: _Save as_ → **CSV UTF-8 (.csv)**.
  - Google Sheets: _File → Download → Comma-separated values_.
- **One file per project.** The project is the **first CLI
  argument**, not a column in the file. Mixing WPs from multiple
  projects in one file is unsupported.

### Run the importer

```
pnpm import:wp <PROJECT_CODE> <path-to-file.csv>
```

Example:

```
pnpm import:wp PRC-2026-001 ./data/lamsonthi-wps.csv
```

The importer is **fail-all transactional**: if any row is invalid —
missing `code` / `name`, a duplicate `code` within the file, or a
`code` that already exists for this project — **nothing is inserted**
and all errors are printed at once. Fix the file and re-run.

Status (`work_package_status`) is not imported; every newly imported
WP gets the DB default `not_started`.

See [ADR 0014](../docs/decisions/0014-wp-import-contract.md) for the
full contract.
