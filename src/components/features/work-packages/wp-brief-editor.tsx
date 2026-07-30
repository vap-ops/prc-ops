"use client";

// Spec 377 U2b — the tablet-first WP brief authoring editor. Three sections
// over a leaf WP's brief: draft fields (save lifecycle, mirroring
// notes-field.tsx's house pattern — toast.success + router.refresh, NOT an
// inline "saved" span), criteria CRUD, evidence-slot CRUD (optionally mapped
// to a criterion), and publish (snapshots the draft into an immutable
// wp_brief_versions row).
//
// Publish is BLOCKED while the draft form has unsaved edits (fresh-eyes
// catch): wp_brief_versions is append-only, so publishing over an unsaved
// edit would freeze the OLD content forever, correctable only by a v+1 the
// PD may not know is needed. Delete (criterion / evidence slot) goes through
// ConfirmActionButton (ui-conventions §7 — no bare destructive buttons); a
// criterion delete additionally names how many evidence slots lose their
// mapping (the FK's ON DELETE SET NULL, mig 075873).
//
// Scope cut, recorded not silently dropped: no display_config CONTROL (the
// vocabulary for "which info types render on the WP page" is undecided —
// spec 377 §4.4/§7 item 2; the value is still round-tripped unchanged on
// every save, never hardcoded null) and no clone-from-project UI (a
// project-level bulk action, out of place inside a single-WP editor — its
// own follow-up slice). No inline edit for evidence slots (delete + re-add
// only) — sort_order auto-appends, matching criteria's own v1 shape.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  BUTTON_SECONDARY_COMPACT,
  BUTTON_DANGER_OUTLINE_COMPACT,
  CARD,
  FIELD_INPUT,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ERROR,
  SECTION_HEADING,
} from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { WP_BRIEF_LABEL } from "@/lib/i18n/labels";
import type { Json } from "@/lib/db/database.types";
import {
  saveWpBriefDraft,
  addWpBriefCriterion,
  deleteWpBriefCriterion,
  addWpBriefEvidenceSlot,
  deleteWpBriefEvidenceSlot,
  publishWpBrief,
} from "@/lib/wp-brief/actions";

export type WpBriefDraft = {
  id: string;
  scopeIncluded: string | null;
  scopeExcluded: string | null;
  quantity: string | null;
  location: string | null;
  sheetCode: string | null;
  sheetRev: string | null;
  displayConfig: Json;
};

export type WpBriefCriterionRow = { id: string; body: string; sortOrder: number };

export type WpBriefEvidenceSlotRow = {
  id: string;
  label: string;
  criterionId: string | null;
  sortOrder: number;
};

export type WpBriefLatestVersion = {
  version: number;
  publishedByName: string;
  publishedAt: string;
};

const SCOPE_MAX = 2000;
const QUANTITY_LOCATION_MAX = 300;
const SHEET_CODE_MAX = 60;
const SHEET_REV_MAX = 30;
const CRITERION_BODY_MAX = 500;
const SLOT_LABEL_MAX = 200;

export function WpBriefEditor({
  projectId,
  workPackageId,
  draft,
  criteria,
  evidenceSlots,
  latestVersion,
}: {
  projectId: string;
  workPackageId: string;
  draft: WpBriefDraft | null;
  criteria: WpBriefCriterionRow[];
  evidenceSlots: WpBriefEvidenceSlotRow[];
  latestVersion: WpBriefLatestVersion | null;
}) {
  // Lifted here (not inside DraftFieldsSection) so PublishSection can block
  // publish while the draft form has unsaved edits.
  const [draftDirty, setDraftDirty] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <DraftFieldsSection
        projectId={projectId}
        workPackageId={workPackageId}
        draft={draft}
        dirty={draftDirty}
        onDirtyChange={setDraftDirty}
      />
      <div className="flex flex-col gap-6">
        <CriteriaSection
          projectId={projectId}
          workPackageId={workPackageId}
          briefId={draft?.id ?? null}
          criteria={criteria}
          evidenceSlots={evidenceSlots}
        />
        <EvidenceSlotsSection
          projectId={projectId}
          workPackageId={workPackageId}
          briefId={draft?.id ?? null}
          evidenceSlots={evidenceSlots}
          criteria={criteria}
        />
      </div>
      <div className="lg:col-span-2">
        <PublishSection
          projectId={projectId}
          workPackageId={workPackageId}
          hasDraft={draft !== null}
          draftDirty={draftDirty}
          latestVersion={latestVersion}
        />
      </div>
    </div>
  );
}

function DraftFieldsSection({
  projectId,
  workPackageId,
  draft,
  dirty,
  onDirtyChange,
}: {
  projectId: string;
  workPackageId: string;
  draft: WpBriefDraft | null;
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [scopeIncluded, setScopeIncluded] = useState(draft?.scopeIncluded ?? "");
  const [scopeExcluded, setScopeExcluded] = useState(draft?.scopeExcluded ?? "");
  const [quantity, setQuantity] = useState(draft?.quantity ?? "");
  const [location, setLocation] = useState(draft?.location ?? "");
  const [sheetCode, setSheetCode] = useState(draft?.sheetCode ?? "");
  const [sheetRev, setSheetRev] = useState(draft?.sheetRev ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const touch =
    <T,>(setter: (v: T) => void) =>
    (value: T) => {
      setter(value);
      onDirtyChange(true);
    };

  const onSave = () => {
    setError(null);
    startSave(async () => {
      const r = await saveWpBriefDraft({
        projectId,
        workPackageId,
        scopeIncluded: scopeIncluded.trim() || null,
        scopeExcluded: scopeExcluded.trim() || null,
        quantity: quantity.trim() || null,
        location: location.trim() || null,
        sheetCode: sheetCode.trim() || null,
        sheetRev: sheetRev.trim() || null,
        // Round-tripped unchanged — this form has no display_config control
        // (spec 377 §4.4/§7 item 2); NEVER hardcode null, it would wipe a
        // value a clone brought over or a later control set.
        displayConfig: draft?.displayConfig ?? null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDirtyChange(false);
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  };

  return (
    <section className={CARD}>
      <h2 className={SECTION_HEADING}>{WP_BRIEF_LABEL}</h2>
      {draft === null ? (
        <p className="text-body text-ink-secondary mb-4">
          ยังไม่มีร่างข้อมูลงาน — กรอกแล้วกดบันทึกเพื่อเริ่มร่าง
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-meta text-ink-secondary">ขอบเขตงาน (รวม)</span>
          <textarea
            className={FIELD_STACKED}
            rows={3}
            maxLength={SCOPE_MAX}
            disabled={saving}
            value={scopeIncluded}
            onChange={(e) => touch(setScopeIncluded)(e.target.value)}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-meta text-ink-secondary">ขอบเขตงาน (ไม่รวม)</span>
          <textarea
            className={FIELD_STACKED}
            rows={2}
            maxLength={SCOPE_MAX}
            disabled={saving}
            value={scopeExcluded}
            onChange={(e) => touch(setScopeExcluded)(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-meta text-ink-secondary">ปริมาณงาน</span>
          <input
            className={`${FIELD_INPUT} mt-1`}
            maxLength={QUANTITY_LOCATION_MAX}
            disabled={saving}
            value={quantity}
            onChange={(e) => touch(setQuantity)(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-meta text-ink-secondary">ตำแหน่ง/โซน</span>
          <input
            className={`${FIELD_INPUT} mt-1`}
            maxLength={QUANTITY_LOCATION_MAX}
            disabled={saving}
            value={location}
            onChange={(e) => touch(setLocation)(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-meta text-ink-secondary">เลขที่แบบอ้างอิง</span>
          <input
            className={`${FIELD_INPUT} mt-1`}
            maxLength={SHEET_CODE_MAX}
            disabled={saving}
            value={sheetCode}
            onChange={(e) => touch(setSheetCode)(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-meta text-ink-secondary">ฉบับแก้ไข (Rev)</span>
          <input
            className={`${FIELD_INPUT} mt-1`}
            maxLength={SHEET_REV_MAX}
            disabled={saving}
            value={sheetRev}
            onChange={(e) => touch(setSheetRev)(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className={BUTTON_PRIMARY} disabled={saving} onClick={onSave}>
          {saving ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        {dirty && !saving ? (
          <span className="text-meta text-ink-secondary">มีการแก้ไขที่ยังไม่ได้บันทึก</span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={`${INLINE_ERROR} mt-2`}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

function CriteriaSection({
  projectId,
  workPackageId,
  briefId,
  criteria,
  evidenceSlots,
}: {
  projectId: string;
  workPackageId: string;
  briefId: string | null;
  criteria: WpBriefCriterionRow[];
  evidenceSlots: WpBriefEvidenceSlotRow[];
}) {
  const router = useRouter();
  const [newBody, setNewBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  const mappedSlotCount = (criterionId: string) =>
    evidenceSlots.filter((s) => s.criterionId === criterionId).length;

  const onAdd = () => {
    if (!briefId || !newBody.trim()) return;
    setError(null);
    startPending(async () => {
      const r = await addWpBriefCriterion({
        projectId,
        workPackageId,
        briefId,
        body: newBody.trim(),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNewBody("");
      router.refresh();
    });
  };

  return (
    <section className={CARD}>
      <h2 className={SECTION_HEADING}>เกณฑ์การยอมรับ</h2>
      <ul className="mb-4 flex flex-col gap-2">
        {criteria.map((c) => {
          const slotCount = mappedSlotCount(c.id);
          const confirmMessage =
            slotCount > 0
              ? `ลบเกณฑ์นี้? จุดถ่ายรูป ${slotCount} จุดที่ผูกกับเกณฑ์นี้จะไม่มีเกณฑ์ที่พิสูจน์อีกต่อไป (จุดถ่ายรูปเองไม่ถูกลบ)`
              : "ลบเกณฑ์นี้?";
          return (
            <li
              key={c.id}
              className="rounded-control border-edge flex items-center justify-between gap-2 border px-3 py-2"
            >
              <span className="text-body text-ink">{c.body}</span>
              <ConfirmActionButton
                idleLabel="ลบ"
                pendingLabel="กำลังลบ…"
                confirmMessage={confirmMessage}
                confirmLabel="ยืนยัน"
                buttonClassName={BUTTON_DANGER_OUTLINE_COMPACT}
                action={() =>
                  deleteWpBriefCriterion({ projectId, workPackageId, criterionId: c.id })
                }
              />
            </li>
          );
        })}
      </ul>
      {briefId ? (
        <div className="flex items-end gap-2">
          <label className="block flex-1">
            <span className="text-meta text-ink-secondary">เพิ่มเกณฑ์</span>
            <input
              className={`${FIELD_INPUT} mt-1`}
              maxLength={CRITERION_BODY_MAX}
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={BUTTON_SECONDARY_COMPACT}
            disabled={pending || !newBody.trim()}
            onClick={onAdd}
          >
            เพิ่ม
          </button>
        </div>
      ) : (
        <p className="text-meta text-ink-secondary">บันทึกร่างข้อมูลงานก่อน จึงจะเพิ่มเกณฑ์ได้</p>
      )}
      {error ? (
        <p role="alert" className={`${INLINE_ERROR} mt-2`}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

function EvidenceSlotsSection({
  projectId,
  workPackageId,
  briefId,
  evidenceSlots,
  criteria,
}: {
  projectId: string;
  workPackageId: string;
  briefId: string | null;
  evidenceSlots: WpBriefEvidenceSlotRow[];
  criteria: WpBriefCriterionRow[];
}) {
  const router = useRouter();
  const [newLabel, setNewLabel] = useState("");
  const [newCriterionId, setNewCriterionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  const criterionBody = (id: string | null) => criteria.find((c) => c.id === id)?.body ?? null;

  const onAdd = () => {
    if (!briefId || !newLabel.trim()) return;
    setError(null);
    startPending(async () => {
      const r = await addWpBriefEvidenceSlot({
        projectId,
        workPackageId,
        briefId,
        label: newLabel.trim(),
        criterionId: newCriterionId || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNewLabel("");
      setNewCriterionId("");
      router.refresh();
    });
  };

  return (
    <section className={CARD}>
      <h2 className={SECTION_HEADING}>จุดถ่ายรูปหลักฐาน</h2>
      <ul className="mb-4 flex flex-col gap-2">
        {evidenceSlots.map((s) => (
          <li
            key={s.id}
            className="rounded-control border-edge flex items-center justify-between gap-2 border px-3 py-2"
          >
            <div>
              <span className="text-body text-ink">{s.label}</span>
              {criterionBody(s.criterionId) ? (
                <span className="text-meta text-ink-secondary block">
                  พิสูจน์: {criterionBody(s.criterionId)}
                </span>
              ) : null}
            </div>
            <ConfirmActionButton
              idleLabel="ลบ"
              pendingLabel="กำลังลบ…"
              confirmMessage={`ลบจุดถ่ายรูป "${s.label}"?`}
              confirmLabel="ยืนยัน"
              buttonClassName={BUTTON_DANGER_OUTLINE_COMPACT}
              action={() => deleteWpBriefEvidenceSlot({ projectId, workPackageId, slotId: s.id })}
            />
          </li>
        ))}
      </ul>
      {briefId ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="text-meta text-ink-secondary">เพิ่มจุดถ่ายรูป</span>
            <input
              className={`${FIELD_INPUT} mt-1`}
              maxLength={SLOT_LABEL_MAX}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </label>
          <label className="block flex-1">
            <span className="text-meta text-ink-secondary">เกณฑ์ที่พิสูจน์ (ถ้ามี)</span>
            <select
              className={`${FIELD_SELECT} mt-1`}
              value={newCriterionId}
              onChange={(e) => setNewCriterionId(e.target.value)}
            >
              <option value="">— ไม่ระบุ —</option>
              {criteria.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.body}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={BUTTON_SECONDARY_COMPACT}
            disabled={pending || !newLabel.trim()}
            onClick={onAdd}
          >
            เพิ่มจุด
          </button>
        </div>
      ) : (
        <p className="text-meta text-ink-secondary">
          บันทึกร่างข้อมูลงานก่อน จึงจะเพิ่มจุดถ่ายรูปได้
        </p>
      )}
      {error ? (
        <p role="alert" className={`${INLINE_ERROR} mt-2`}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PublishSection({
  projectId,
  workPackageId,
  hasDraft,
  draftDirty,
  latestVersion,
}: {
  projectId: string;
  workPackageId: string;
  hasDraft: boolean;
  draftDirty: boolean;
  latestVersion: WpBriefLatestVersion | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [publishing, startPublish] = useTransition();

  const canPublish = hasDraft && !draftDirty;

  const onPublish = () => {
    setError(null);
    startPublish(async () => {
      const r = await publishWpBrief({ projectId, workPackageId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success("เผยแพร่แล้ว");
      router.refresh();
    });
  };

  return (
    <section className={CARD}>
      <h2 className={SECTION_HEADING}>เผยแพร่</h2>
      {latestVersion ? (
        <p className="text-body text-ink-secondary mb-3">
          เวอร์ชัน {latestVersion.version} เผยแพร่โดย {latestVersion.publishedByName} เมื่อ{" "}
          {latestVersion.publishedAt}
        </p>
      ) : (
        <p className="text-body text-ink-secondary mb-3">ยังไม่เคยเผยแพร่ข้อมูลงานนี้</p>
      )}
      {hasDraft && draftDirty ? (
        <p className="text-meta text-ink-secondary mb-3">
          บันทึกร่างข้อมูลงานก่อน จึงจะเผยแพร่การแก้ไขล่าสุดได้
        </p>
      ) : null}
      <button
        type="button"
        className={canPublish ? BUTTON_PRIMARY : BUTTON_SECONDARY}
        disabled={!canPublish || publishing}
        onClick={onPublish}
      >
        {publishing ? "กำลังเผยแพร่…" : "เผยแพร่ข้อมูลงาน"}
      </button>
      {error ? (
        <p role="alert" className={`${INLINE_ERROR} mt-2`}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
