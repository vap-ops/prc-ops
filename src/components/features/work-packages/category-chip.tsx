// Spec 277 U1 — CategoryChip: the single render point for a work-category's
// visual identity (letter · colour · icon), sibling of StatusPill. Given a
// work_categories.code it draws a solid category-coloured tile with the white
// letter and, when a label is supplied, the category icon + Thai name. Pure
// display. Returns null for an uncategorised / unknown code — the caller renders
// its own "ยังไม่ระบุหมวดงาน" state (e.g. WorkCategoryBadge), so this never
// invents an identity for an unbound WP.

import { workCategoryIdentity } from "@/lib/work-categories/identity";

export function CategoryChip({
  code,
  label,
  className,
}: {
  /** work_categories.code — a 3-char top (W02) or 5-char subsection (W0203). */
  code: string | null | undefined;
  /** The category name (Thai). Omit for an icon-only tile chip. */
  label?: string;
  className?: string;
}) {
  const identity = workCategoryIdentity(code);
  if (!identity) return null;

  const Icon = identity.icon;
  const hasLabel = label != null && label !== "";

  return (
    <span
      className={`text-meta inline-flex shrink-0 items-center gap-1.5 leading-none${
        className ? ` ${className}` : ""
      }`}
      // With a visible label the text carries the accessible name; icon-only
      // still needs one, so fall back to the code.
      {...(hasLabel ? {} : { role: "img", "aria-label": identity.code, title: identity.code })}
    >
      <span
        aria-hidden
        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-[0.4rem] font-mono text-[0.7rem] font-bold text-white ${identity.tileClass}`}
      >
        {identity.letter}
      </span>
      {hasLabel ? (
        <>
          <Icon aria-hidden className={`size-3.5 shrink-0 ${identity.accentClass}`} />
          <span className="text-ink font-medium">{label}</span>
        </>
      ) : null}
    </span>
  );
}
