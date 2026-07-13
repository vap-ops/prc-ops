// Spec 314 U4 (help) — the pay-model explainer for /settings/labor-rates. A native
// <details> accordion (zero-JS server component, same visual pattern as the SA
// help-card) titled by the topic, expanding to an intro + a definition list of the
// ADR 0082 pay-model concepts. Collapsed by default so it never pushes the rate
// form down for repeat users; content is data (pay-model-help.ts).

import {
  PAY_MODEL_HELP_INTRO,
  PAY_MODEL_HELP_POINTS,
  PAY_MODEL_HELP_TITLE,
} from "@/lib/help/pay-model-help";

export function PayModelExplainer() {
  return (
    <details className="rounded-card border-edge bg-card shadow-card border px-4 py-3">
      <summary className="text-ink text-body cursor-pointer font-semibold">
        {PAY_MODEL_HELP_TITLE}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-ink-secondary text-sm">{PAY_MODEL_HELP_INTRO}</p>
        <dl className="flex flex-col gap-3">
          {PAY_MODEL_HELP_POINTS.map((point) => (
            <div key={point.term} className="flex flex-col gap-0.5">
              <dt className="text-ink text-sm font-semibold">{point.term}</dt>
              <dd className="text-ink-secondary text-sm">{point.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
