<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

- This project uses TDD. For any new feature, write a failing test first, then make it pass. No production code without a test.
- Database is Postgres via Supabase. Every table has Row Level Security enabled. No exceptions.
- The audit_log table is append-only. Never UPDATE or DELETE rows in audit_log.
- DC entries and photo_logs are append-only. Edits happen via supersede (new row pointing at old via superseded_by FK), never UPDATE.
- All status fields use Postgres enums, never free-text strings.
- Foreign keys are typed and validated. No mixed-content reference columns.
- No `any` types in TypeScript. Use `unknown` and narrow.
- Server Components by default. Use Client Components only when interactivity requires it.
- Before implementing any feature, read /docs/decisions/ in full. Architecture decisions there override defaults.
- Commit messages follow Conventional Commits (feat:, fix:, test:, docs:, refactor:, chore:).
- Every PR runs the test suite. PRs that don't pass tests do not get reviewed.

### Library and architecture discipline

- Do NOT silently swap libraries, frameworks, or fundamental approaches when implementing a spec.
- If a library named in the spec proves unworkable, STOP and report the blocker. Do not implement a fallback unless explicitly approved.
- "It was simpler with X" is not a reason. The spec specifies the library because the spec specifies the question being answered.
- Architectural choices that are not in the spec must be raised before implementation, not after.
- This rule applies equally to spikes and production code.
