// Report download filename (spec 60): {code}-report-{YYYYMMDD}.pdf —
// ASCII-safe (project codes are Latin by convention, spec 14), date
// pinned to Asia/Bangkok like every user-facing date. Used for the
// signed-URL attachment disposition AND the share-sheet File name.

const BANGKOK_YMD = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Bangkok",
});

export function buildReportFileName(projectCode: string, createdAtIso: string): string {
  const d = new Date(createdAtIso);
  if (Number.isNaN(d.getTime())) return `${projectCode}-report.pdf`;
  const ymd = BANGKOK_YMD.format(d).replaceAll("-", "");
  return `${projectCode}-report-${ymd}.pdf`;
}
