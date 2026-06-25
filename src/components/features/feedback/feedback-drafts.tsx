"use client";

// Spec 201 U4 — the operator's approval gate. CC stages reply drafts (it cannot
// reach a reporter on its own — locked dial 1); this lists the pending drafts for
// the super_admin to review. อนุมัติ publishes a draft as an agent message the
// reporter then sees; ทิ้ง drops it unsent. Renders nothing when there are none.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishFeedbackDraft, discardFeedbackDraft } from "@/app/feedback/[id]/actions";
import { useToast } from "@/lib/ui/use-toast";
import { CARD } from "@/lib/ui/classes";

export type PendingDraft = { id: string; body: string; createdAt: string };

export function FeedbackDrafts({ drafts }: { drafts: PendingDraft[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (drafts.length === 0) return null;

  function run(id: string, kind: "publish" | "discard") {
    setBusyId(id);
    startTransition(async () => {
      const result =
        kind === "publish" ? await publishFeedbackDraft(id) : await discardFeedbackDraft(id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(kind === "publish" ? "ส่งให้ผู้แจ้งแล้ว" : "ทิ้งร่างแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-ink text-base font-semibold">ร่างจากผู้ช่วย AI · รออนุมัติ</h2>
      <ul className="flex flex-col gap-3">
        {drafts.map((d) => (
          <li key={d.id} className={`${CARD} border-attn-edge flex flex-col gap-3 border-l-4`}>
            <p className="text-ink-secondary text-sm whitespace-pre-wrap">{d.body}</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending && busyId === d.id}
                onClick={() => run(d.id, "publish")}
                className="bg-fill text-on-fill rounded-control focus-visible:ring-action h-9 flex-1 px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                อนุมัติและส่ง
              </button>
              <button
                type="button"
                disabled={pending && busyId === d.id}
                onClick={() => run(d.id, "discard")}
                className="border-edge text-ink-secondary hover:bg-sunk rounded-control focus-visible:ring-action h-9 border px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                ทิ้ง
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
