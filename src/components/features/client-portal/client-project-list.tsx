// Spec 234 / ADR 0067 U2 — when a client has access to more than one project,
// /client lists them; tapping a card opens that project's progress page. A
// Server Component (no 'use client'): own header + logout, no internal nav.

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import type { ClientProjectSummary } from "@/lib/client-portal/load-client-projects";

export function ClientProjectList({ projects }: { projects: ReadonlyArray<ClientProjectSummary> }) {
  return (
    <PageShell>
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink font-bold tracking-tight">ความคืบหน้าโครงการ</h1>
          <LogoutButton />
        </div>
      </header>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>โครงการของคุณ</h2>
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/client/${p.id}`}
                className={`${CARD} flex items-center justify-between gap-3`}
              >
                <span className="min-w-0">
                  <span className="text-ink-muted block font-mono text-xs">{p.code}</span>
                  <span className="text-ink block truncate text-sm font-medium">{p.name}</span>
                </span>
                <span className="text-ink-secondary shrink-0 text-xs">
                  {PROJECT_STATUS_LABEL[p.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
