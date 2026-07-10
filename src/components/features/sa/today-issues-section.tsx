// Spec 277 P1a — ปัญหาวันนี้: today's site issues on the SA home. Renders nothing
// when empty (the home's conditional-section idiom, like SaActionSection /
// MusterStrip). Presentational — the page loads + signs the rows (loadTodayIssues).

import { SITE_ISSUE_TYPE_ICON } from "@/lib/site-issues/identity";
import {
  SITE_ISSUE_TYPE_LABEL,
  SITE_ISSUE_STATUS_LABEL,
  TODAY_ISSUES_LABEL,
} from "@/lib/i18n/labels";
import type { TodayIssueView } from "@/lib/site-issues/load-today-issues";

export function TodayIssuesSection({ issues }: { issues: TodayIssueView[] }) {
  if (issues.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-meta text-ink-secondary font-semibold">{TODAY_ISSUES_LABEL}</h2>
      <ul className="flex flex-col gap-3">
        {issues.map((it) => {
          const Icon = SITE_ISSUE_TYPE_ICON[it.issueType];
          const resolved = it.status === "resolved";
          return (
            <li key={it.id} className="rounded-card border-edge bg-card shadow-card border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <Icon
                    aria-hidden
                    className={`mt-0.5 size-5 shrink-0 ${resolved ? "text-ink-muted" : "text-danger"}`}
                  />
                  <div className="min-w-0">
                    <p className="text-ink text-body font-semibold">
                      {SITE_ISSUE_TYPE_LABEL[it.issueType]}
                    </p>
                    {it.projectName ? (
                      <p className="text-ink-muted text-meta">{it.projectName}</p>
                    ) : null}
                  </div>
                </div>
                <span
                  className={`text-meta shrink-0 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap ${
                    resolved ? "bg-sunk text-ink-muted" : "bg-danger-soft text-danger-ink"
                  }`}
                >
                  {SITE_ISSUE_STATUS_LABEL[it.status]}
                </span>
              </div>

              {it.note ? (
                <p className="text-ink-secondary text-meta mt-2 break-words whitespace-pre-wrap">
                  {it.note}
                </p>
              ) : null}

              {it.thumbnailUrls.length > 0 ? (
                <div className="mt-3 flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto">
                  {it.thumbnailUrls.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={url}
                      alt="รูปปัญหา"
                      className="border-edge size-16 shrink-0 rounded-md border object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
