# prc-ops

Construction project operations platform for PRC site admins and project managers. The UI is Thai-first (spec 14) — users are Thai construction-site staff.

- **Site admins** upload progress photos, track work packages (grouped by deliverable), and raise purchase requests from the field.
- **Project managers** review and approve work packages, decide purchase requests, and generate PDF reports.
- **Procurement (back office)** records purchases and deliveries in AppSheet, writing directly to the database via a restricted Postgres role (ADR 0018/0025).

Built with Next.js 16 App Router, Supabase (Postgres + Auth via LINE Login + Storage), Tailwind CSS v4, and shadcn/ui. A separate worker (`worker/`, deployed on Railway) generates the PDF reports.

## Local Setup

**Prerequisites:** Node.js 22+, pnpm 10+

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

# Run the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Commands

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Start development server                |
| `pnpm build`         | Build for production                    |
| `pnpm lint`          | Run ESLint                              |
| `pnpm typecheck`     | Run TypeScript type-check               |
| `pnpm test`          | Run unit and integration tests (Vitest) |
| `pnpm test:watch`    | Run tests in watch mode                 |
| `pnpm test:coverage` | Run tests with coverage report          |
| `pnpm test:e2e`      | Run E2E tests (Playwright)              |
| `pnpm format`        | Format all files with Prettier          |

## Running Tests

```bash
# Unit and integration tests
pnpm test

# E2E tests (requires dev server or built app)
pnpm test:e2e
```

## Project Structure

```
src/
  app/                  Next.js App Router pages and layouts
  components/
    ui/                 shadcn/ui primitives only
    features/           Feature-level components
  lib/                  Shared utilities (i18n labels, status colors, domain helpers)
  lib/db/               Database clients (browser / server / admin) and generated types
supabase/
  migrations/           Schema (timestamped SQL; the only write path to the DB)
  tests/database/       pgTAP tests (`pnpm db:test`)
worker/                 PDF report worker (isolated subproject, Railway)
tests/
  unit/                 Vitest unit tests
  integration/          Vitest integration tests
  e2e/                  Playwright E2E tests
docs/
  decisions/            Architecture Decision Records (ADRs) — binding
  feature-specs/        Numbered, locked feature specs
```

## Where to start reading

1. [`CLAUDE.md`](CLAUDE.md) — project rules, workflow, architecture invariants (binding).
2. [`docs/v2-handoff.md`](docs/v2-handoff.md) — the start-here context bridge.
3. [`docs/decisions/`](docs/decisions/) — all ADRs (0001 stack through the latest; read before implementing any feature). The list grows; the directory is the source of truth, not a table here.
4. The tail of [`docs/progress-tracker.md`](docs/progress-tracker.md) — the most recent unit's state and its open-questions queue.
