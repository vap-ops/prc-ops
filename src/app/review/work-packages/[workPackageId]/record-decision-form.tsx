"use client";

import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";

// PM record-decision form.
//
// Spec 372 U2 — the PM answers ONE question (อนุมัติ / ไม่อนุมัติ) and then says what
// is WRONG. They never pick a mechanism.
//
// Before, three peer radios sat on different axes — "ถ่ายรูปใหม่" instructed the SA,
// "ส่งกลับแก้งาน" described the PM's own action — with the reason chips hidden one
// level down inside the middle one. Measured on prod: `rejected` was chosen **0 times
// in five weeks**, and `premature` ("งานยังไม่เสร็จ", which is about the WORK) also sat
// at 0, because a PM who thought "the work isn't done" already found a home inside the
// OTHER button and never reached the third radio.
//
// The cause → (decision, reason) route lives in `decisionPayloadForCause`, so it is
// testable over its whole domain and the form holds no routing logic of its own. The
// server action (recordDecision) remains the load-bearing validator; this form just
// refuses to send obviously-bad input so the user gets fast feedback.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  commentRequiredFor,
  DECISION_CAUSES,
  decisionPayloadForCause,
  FLAGGABLE_PHASES,
  isCommentValid,
  targetsForCause,
  type DecisionCause,
  type FlaggablePhase,
} from "@/lib/approvals/predicates";
import {
  APPROVAL_DECISION_LABEL,
  APPROVAL_REVISION_REASON_LABEL,
  PHOTO_PHASE_LABEL,
} from "@/lib/i18n/labels";
import { recordDecision } from "./actions";

// Every cause label is single-sourced: the three photo causes from the spec-355 reason
// map, the work cause from APPROVAL_DECISION_LABEL — the same value the SA's chip,
// /review, the ประวัติ timeline and notifications render, so the PM's choice and what
// the SA later reads are the same words (the spec-353 rule).
const CAUSE_LABEL: Record<DecisionCause, string> = {
  incomplete: APPROVAL_REVISION_REASON_LABEL.incomplete,
  mismatch: APPROVAL_REVISION_REASON_LABEL.mismatch,
  premature: APPROVAL_REVISION_REASON_LABEL.premature,
  rework: APPROVAL_DECISION_LABEL.rejected,
};

// What HAPPENS, in words a PM decides on — never round counters or photo-bucket names.
// Spec 372 U3 moved `premature` off the queue-stays line: the WORK is unfinished, so
// the WP goes back to หน้างาน as ordinary active work. Only the two PHOTO causes keep
// it in the queue now, and this copy must not outlive that.
const CAUSE_HINT: Record<DecisionCause, string> = {
  incomplete: "ช่างเพิ่มรูปที่ขาด แล้วส่งตรวจอีกครั้ง · ยังอยู่ในคิวตรวจ",
  mismatch: "ช่างลบรูปที่ผิดแล้วถ่ายใหม่ · ยังอยู่ในคิวตรวจ",
  premature: "งานจะกลับไปเป็นงานที่กำลังทำ ช่างทำให้เสร็จแล้วค่อยส่งตรวจใหม่",
  rework: "งานจะออกจากคิวตรวจ กลับไปให้หน้างานแก้ แล้วช่างถ่ายรูปหลังแก้เสร็จ",
};

/** Spec 372 U4b — one current photo the PM can point at. `seq` is the per-PHASE
 *  ordinal the SA sees on the tile (spec 340: retired-not-renumbered on delete, so a
 *  number is safe to quote), which is why the label always carries the phase too —
 *  "#3" alone is ambiguous across phases. */
export interface DecisionPhoto {
  id: string;
  phase: FlaggablePhase;
  seq: number;
  url: string | null;
}

interface RecordDecisionFormProps {
  workPackageId: string;
  /** The WP's CURRENT photos (tombstones and superseded rows already excluded by the
   *  page's read) — what `รูปไม่ตรงกับงาน` points at. */
  photos?: ReadonlyArray<DecisionPhoto>;
}

export function RecordDecisionForm({ workPackageId, photos = [] }: RecordDecisionFormProps) {
  const router = useRouter();
  const [approve, setApprove] = useState<boolean | null>(null);
  const [cause, setCause] = useState<DecisionCause | null>(null);
  // Spec 372 U4a — which lifecycle phases the PM says are missing. Only meaningful
  // for the incomplete cause; targetsForCause drops them for every other one, so a
  // stale tick can never ride a payload the RPC would refuse (22023).
  const [phases, setPhases] = useState<ReadonlyArray<FlaggablePhase>>([]);
  // Spec 372 U4b — which existing photos are the wrong ones. Same optional, same
  // cleared-on-cause-switch rule as the phases above.
  const [photoIds, setPhotoIds] = useState<ReadonlyArray<string>>([]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  // `approved` carries neither a reason nor a required comment; otherwise the chosen
  // cause decides both. Nothing is sent until a cause is picked, so a half-answered
  // "ไม่อนุมัติ" can never reach the RPC.
  //
  // Deliberately keyed on `cause` alone: `pickApprove` clears it, so an `approve ===
  // false &&` conjunct here would be unreachable — and an unreachable guard asserts a
  // hazard that is not there (spec 340). Mutation-checked both ways: with the reset in
  // place that conjunct could be deleted with every test still green, so the reset is
  // the single truth and carries its own test. The action and the RPC re-validate.
  const payload = cause ? decisionPayloadForCause(cause) : null;
  const decision = approve === true ? ("approved" as const) : payload?.decision;
  const needsComment = decision ? commentRequiredFor(decision) : false;
  const canSubmit =
    decision !== undefined &&
    isCommentValid(decision, comment.length ? comment : null) &&
    !submitting;

  function togglePhase(ph: FlaggablePhase) {
    setPhases((prev) => (prev.includes(ph) ? prev.filter((p) => p !== ph) : [...prev, ph]));
  }

  function togglePhoto(id: string) {
    setPhotoIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  /** Select-all for one phase — the genuine "เปลี่ยนรูปใหม่ทั้งหมด" case that appears
   *  in the live comments. Toggles: pressing it again clears that phase. */
  function togglePhasePhotos(phase: FlaggablePhase) {
    const ids = photos.filter((p) => p.phase === phase).map((p) => p.id);
    const allOn = ids.length > 0 && ids.every((id) => photoIds.includes(id));
    setPhotoIds((prev) =>
      allOn
        ? prev.filter((id) => !ids.includes(id))
        : [...prev, ...ids.filter((id) => !prev.includes(id))],
    );
  }

  function pickCause(next: DecisionCause) {
    setCause(next);
    // Switching cause abandons the targets — each shape belongs to ONE cause, and a
    // stale one riding the other's payload is a 22023 from the RPC.
    if (next !== "incomplete") setPhases([]);
    if (next !== "mismatch") setPhotoIds([]);
  }

  function pickApprove(next: boolean) {
    setApprove(next);
    // Switching back to อนุมัติ must drop the cause: a stale reason riding an
    // `approved` payload is exactly what the RPC refuses (22023).
    if (next) {
      setCause(null);
      setPhases([]);
      setPhotoIds([]);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!decision) return;
    setError(null);
    startSubmit(async () => {
      const result = await recordDecision({
        workPackageId,
        decision,
        comment: comment.length > 0 ? comment : null,
        revisionReason: payload?.revisionReason ?? null,
        ...(cause
          ? targetsForCause(cause, phases, photoIds)
          : { targetPhases: null, targetPhotoIds: null }),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Decision recorded. `approved` flips the WP to `complete` and `rejected` flips
      // it to `rework` (spec 337 F3) — both drop off the queue; the three photo causes
      // leave it at pending_approval awaiting the SA's re-shoot, with an updated
      // latest-decision label. Either way, the queue is the right landing.
      router.push("/review");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-card border-edge bg-card shadow-card flex flex-col gap-4 border p-5"
    >
      <fieldset className="flex flex-col gap-2" disabled={submitting}>
        <legend className="text-ink mb-1 text-sm font-medium">ผลการตรวจ</legend>
        <ChoiceRow
          name="approve"
          checked={approve === true}
          onPick={() => pickApprove(true)}
          label="อนุมัติ"
          hint="รายการงานจะเปลี่ยนเป็นเสร็จสิ้น"
        />
        <ChoiceRow
          name="approve"
          checked={approve === false}
          onPick={() => pickApprove(false)}
          label="ไม่อนุมัติ"
          hint="เลือกว่าติดอะไร แล้วระบบจะส่งต่อให้เอง"
        />
      </fieldset>

      {/* The four causes, one axis: each names a PROBLEM. Which decision and which
          spec-355 reason that becomes is decisionPayloadForCause's job. */}
      {approve === false ? (
        <fieldset className="flex flex-col gap-2" disabled={submitting}>
          <legend className="text-ink mb-1 text-sm font-medium">
            ติดอะไร <span className="text-danger">*</span>
          </legend>
          {DECISION_CAUSES.map((c) => (
            <ChoiceRow
              key={c}
              name="cause"
              checked={cause === c}
              onPick={() => pickCause(c)}
              label={CAUSE_LABEL[c]}
              hint={CAUSE_HINT[c]}
            />
          ))}
        </fieldset>
      ) : null}

      {/* Spec 372 U4a — WHICH phases are missing. Optional by design: a PM who cannot
          say still gets to bounce the photos, so this never gates submit. Only the
          three lifecycle phases are offered — the RPC refuses after_fix and defect,
          which are not a normal cycle's completion evidence. */}
      {cause === "incomplete" ? (
        <fieldset className="flex flex-col gap-2" disabled={submitting}>
          <legend className="text-ink mb-1 text-sm font-medium">
            ช่วงไหนที่ยังขาด <span className="text-ink-secondary">(ไม่บังคับ)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {FLAGGABLE_PHASES.map((ph) => {
              const on = phases.includes(ph);
              return (
                <label
                  key={ph}
                  className={`rounded-control focus-within:ring-action flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm font-medium transition-colors focus-within:ring-2 ${
                    on
                      ? "border-action bg-action-soft text-ink"
                      : "border-edge-strong bg-card text-ink-secondary hover:bg-page"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => togglePhase(ph)}
                    className="accent-fill"
                  />
                  {PHOTO_PHASE_LABEL[ph]}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {/* Spec 372 U4b — WHICH photos are wrong. Optional, like the phases: a PM who
          cannot single any out still gets to bounce them. Grouped by phase because
          `seq` is a PER-PHASE ordinal, so "#3" alone is ambiguous. */}
      {cause === "mismatch" ? (
        <fieldset className="flex flex-col gap-3" disabled={submitting}>
          <legend className="text-ink mb-1 text-sm font-medium">
            รูปไหนที่ไม่ตรง <span className="text-ink-secondary">(ไม่บังคับ)</span>
          </legend>
          {photos.length === 0 ? (
            <p className="text-ink-secondary text-sm">ยังไม่มีรูปให้เลือก</p>
          ) : (
            FLAGGABLE_PHASES.filter((ph) => photos.some((p) => p.phase === ph)).map((ph) => {
              const inPhase = photos.filter((p) => p.phase === ph);
              const allOn = inPhase.every((p) => photoIds.includes(p.id));
              return (
                <div key={ph} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-ink text-sm font-semibold">{PHOTO_PHASE_LABEL[ph]}</span>
                    <button
                      type="button"
                      onClick={() => togglePhasePhotos(ph)}
                      aria-pressed={allOn}
                      className="rounded-control border-edge-strong bg-card text-ink-secondary hover:bg-page focus-visible:ring-action inline-flex min-h-11 items-center border px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2"
                    >
                      {PHOTO_PHASE_LABEL[ph]} · ทั้งหมดในช่วงนี้
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {inPhase.map((p) => {
                      const on = photoIds.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={`rounded-control focus-within:ring-action flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm font-medium transition-colors focus-within:ring-2 ${
                            on
                              ? "border-action bg-action-soft text-ink"
                              : "border-edge-strong bg-card text-ink-secondary hover:bg-page"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => togglePhoto(p.id)}
                            className="accent-fill"
                          />
                          {/* The phase rides the label: seq is per-phase, and this is
                              the exact string the SA reads back on the card. */}
                          {PHOTO_PHASE_LABEL[p.phase]} #{p.seq}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="approval-comment" className="text-ink text-sm font-medium">
          ความเห็น{" "}
          {needsComment ? (
            <span className="text-danger">*</span>
          ) : (
            <span className="text-ink-secondary">(ไม่บังคับ)</span>
          )}
        </label>
        <Textarea
          id="approval-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          required={needsComment}
          disabled={submitting}
          placeholder={needsComment ? "อธิบายสิ่งที่ต้องแก้ไข" : "บันทึกเพิ่มเติม (ถ้ามี)"}
          className="border-edge-strong bg-card text-ink placeholder:text-ink-muted min-h-24"
        />
      </div>

      {error && (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? "กำลังบันทึก…" : "บันทึกผลการตรวจ"}
        </button>
      </div>
    </form>
  );
}

/** One radio row — label above, consequence below. Shared by both steps so the two
 *  read as the same kind of choice. */
function ChoiceRow({
  name,
  checked,
  onPick,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  onPick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
        checked ? "border-action bg-action-soft" : "border-edge-strong bg-card hover:bg-page"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onPick}
        className="accent-fill mt-1"
      />
      <span className="flex flex-col">
        <span className="text-ink text-sm font-medium">{label}</span>
        <span className="text-ink-secondary text-xs">{hint}</span>
      </span>
    </label>
  );
}
