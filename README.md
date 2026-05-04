# prc-ops

Construction project operations platform for PRC site admins and project managers.

- **Site admins** use the PWA to upload progress photos and update work package status from the field.
- **Project managers** use the web app to approve work packages and generate PDF reports.

Built with Next.js 15 App Router, Supabase (Postgres + Auth + Storage), Tailwind CSS v4, and shadcn/ui.

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
  lib/                  Shared utilities
  lib/db/               Database client and types
tests/
  unit/                 Vitest unit tests
  integration/          Vitest integration tests
  e2e/                  Playwright E2E tests
docs/
  decisions/            Architecture Decision Records (ADRs)
  specs/                Feature specifications
```

## Architecture Decision Log

See [docs/decisions/](docs/decisions/) for all ADRs. Start here before implementing any feature.

| ADR                                        | Title                             |
| ------------------------------------------ | --------------------------------- |
| [0001](docs/decisions/0001-stack.md)       | Technology Stack                  |
| [0002](docs/decisions/0002-data-import.md) | WP Data Import Strategy           |
| [0003](docs/decisions/0003-photos.md)      | Photo Upload and Watermarking     |
| [0004](docs/decisions/0004-audit.md)       | Audit Trail and Data Immutability |
| [0005](docs/decisions/0005-scope-v1.md)    | v1 Scope                          |
