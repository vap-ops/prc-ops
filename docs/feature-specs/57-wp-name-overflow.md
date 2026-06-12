# Spec 57 — long WP names never truncate

**Status:** complete (2026-06-13) — operator eye on deploy = acceptance
**Date:** 2026-06-13
**Origin:** operator screenshot 2026-06-13 ("งานปรับพื้นที่อาคาร (+0.0…"):
"handle when WP Name is too long, also remember that WP is the center
of information. Scope/Time/Resource everything is mapped against WP."

## Principle (recorded — binding for future design rounds)

The WP is the hub every fact maps against (scope, time, resource). Its
identity — code + full name — must always be fully readable. Truncating
a WP name hides the information the whole screen is organised around.

## Scope (class-only restyle)

1. WP detail h1, SA + PM pages: `truncate` → full wrap
   (`break-words`, no clamp) — the detail page IS the WP, the name owns
   as many lines as it needs.
2. WP list rows (work-package-list rowLink): `truncate` →
   `line-clamp-2 break-words` — bounded rows, but two lines of Thai
   carry nearly every real WP name.
3. PM queue rows (/pm): the code·name line `truncate` →
   `line-clamp-2 break-words`.
4. Request detail h1 (item_description): same full-wrap treatment —
   same hub argument, the description is what the request is.
5. `docs/ui-conventions.md` gains the rule: WP names never truncate —
   clamp-2 in lists, full wrap on detail headers.

NOT changed (recorded): PurchaseRequestCard stays slim (test-pinned
contract); meta lines (project line, WP link line on request detail)
keep truncate — they are context, not the page's subject.

## Tests

Class-only restyle — spec-40 precedent, full suite + build stay green.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Operator: WP02's full name visible on the detail page and as two
   lines in the list.
