// Spec 318 U1 — OA friendship probe (LINE Login "linked OA" feature).
// Called from the OAuth callback with the USER's login access token;
// requires the OA (@070vkizw) linked to the Login channel in the LINE
// console (same provider — the push channel already shares it).
//
// null = unknown (API error / malformed body) — callers must treat null
// as "don't update the stored flag", never as "not a friend". Never
// throws: a friendship probe must never break login.

const FRIENDSHIP_STATUS_URL = "https://api.line.me/friendship/v1/status";

export async function fetchLineFriendFlag(accessToken: string): Promise<boolean | null> {
  try {
    const response = await fetch(FRIENDSHIP_STATUS_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      // The probe rides the login redirect hot path — a hanging LINE API
      // must degrade to null fast, not stall sign-in (fresh-eyes finding).
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { friendFlag?: unknown };
    return typeof json.friendFlag === "boolean" ? json.friendFlag : null;
  } catch {
    return null;
  }
}
