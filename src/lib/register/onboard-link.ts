// Spec 279 F2a — the self-onboard link a SA hands a technician (via a per-project
// QR on /sa/crew). It carries three params so the QR is final ahead of F2b's
// attribution schema:
//   - `project` — the project id the applicant is joining (F2b stores it as
//     staff_registrations.invited_project_id)
//   - `site`    — a human-readable site label, shown on /register/technician so
//     the applicant can eyeball that they scanned the right project's QR. It is
//     display-only and untrusted (the SA minted it); React escapes it as text.
//   - `by`      — the inviting SA's user id (F2b stores it as invited_by)
//
// A pure builder (no DB, no env) so the URL shape is unit-testable and there is
// ONE place that spells the param names — /sa/crew (encode) and the register page
// (decode) must agree. Uses URL/searchParams so the Thai `site` label is encoded
// correctly regardless of content.
export function technicianOnboardUrl(
  base: string,
  opts: { projectId: string; siteLabel: string; inviterId: string },
): string {
  const url = new URL("/register/technician", base);
  url.searchParams.set("project", opts.projectId);
  url.searchParams.set("site", opts.siteLabel);
  url.searchParams.set("by", opts.inviterId);
  return url.toString();
}
