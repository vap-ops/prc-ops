// Spec 92 Unit D — the schedule's "today" anchor (today line + past shading).
// Asia/Bangkok (UTC+7) civil date. Lives in a plain module (not a component)
// so the Date.now() read is outside React's purity rule — the server renders
// it once per request, which is the intended behaviour.
export function bangkokTodayISO(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
