// Spec 396 U2 — resolving WHOSE account a portal-bound worker record belongs to.
//
// Pure on purpose: the page that uses this is a Server Component the vitest suite
// cannot render, so the identity decisions (which field counts as a name, what a
// blank means, what a missing user row means) live here where they can be tested
// directly instead of only through a hand-built component fixture.

/** The subset of `public.users` this resolution needs. */
export interface BoundOwnerUser {
  id: string;
  full_name: string | null;
  line_display_name: string | null;
}

/**
 * The label to show for a bound account holder, or null when we have nothing
 * trustworthy to show.
 *
 * ⚠️ `line_display_name` is DELIBERATELY not a fallback. It is a self-chosen LINE
 * handle — a nickname, an emoji, whatever the person set — and this line exists to
 * answer "is this the person I mean?". Presenting a handle as registered identity
 * would answer it wrongly, which is worse than answering nothing: the caller
 * renders a neutral "this record belongs to a linked account" instead, and the
 * reader goes and checks. Only `users.full_name`, the registered name, qualifies.
 */
export function boundOwnerLabel(user: BoundOwnerUser | undefined | null): string | null {
  const name = user?.full_name?.trim();
  return name ? name : null;
}

/**
 * Map user id → display label for the bound holders of a roster. Ids with no user
 * row, or whose user has no registered name, are simply absent from the map — the
 * caller then renders the neutral form, never "unbound" (that is derived from
 * `workers.user_id` independently, so a lookup miss can never make an owned record
 * look free to edit).
 */
export function mapBoundOwnerNames(users: readonly BoundOwnerUser[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const u of users) {
    const label = boundOwnerLabel(u);
    if (label) byId.set(u.id, label);
  }
  return byId;
}

/** The distinct, non-null user ids of a roster — the ids worth looking up. */
export function boundUserIdsOf(rows: readonly { user_id: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.user_id).filter((id): id is string => id !== null))];
}
