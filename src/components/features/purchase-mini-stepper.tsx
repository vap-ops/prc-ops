// Spec 111 — a compact, DECORATIVE 5-segment progress bar: the grid-density
// echo of PurchaseRequestTracker. Shares the stage logic (order-stages.ts), so a
// row's bar fills to the same point the full stepper would. aria-hidden — the
// status pill beside it carries the accessible status; this is a visual cue only.

import { orderStageStates } from "@/lib/purchasing/order-stages";
import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export function PurchaseMiniStepper({ status }: { status: PurchaseRequestStatus }) {
  const steps = orderStageStates(status);
  return (
    <span aria-hidden className="flex w-full max-w-[120px] items-center gap-0.5">
      {steps.map((step) => {
        const fill =
          step.state === "rejected" ? "bg-danger" : step.reached ? "bg-done-strong" : "bg-edge";
        return <span key={step.stage} className={`h-1.5 flex-1 rounded-full ${fill}`} />;
      })}
    </span>
  );
}
