// Spec 327 U2/U3 — the one-tap picker prompt shared by the S/T/R views when no
// project is selected (§0.4: selection is never more than one tap away). A
// compact form of the dashboard cards: name-only <form> buttons bound to the
// U1 setProcurementProject Server Action (httpOnly cookie write).

import { setProcurementProject } from "./actions";

export function ProjectPickerPrompt({
  heading,
  projects,
}: {
  heading: string;
  projects: ReadonlyArray<{ id: string; name: string }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-body text-ink-secondary font-semibold">{heading}</h2>
      <div className="flex flex-col gap-2">
        {projects.map((p) => (
          <form key={p.id} action={setProcurementProject.bind(null, p.id)}>
            <button
              type="submit"
              className="rounded-card shadow-card border-edge bg-card text-ink hover:bg-sunk flex min-h-11 w-full items-center gap-3 border px-4 py-3 text-left"
            >
              <span className="text-body min-w-0 flex-1 truncate font-semibold">{p.name}</span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
