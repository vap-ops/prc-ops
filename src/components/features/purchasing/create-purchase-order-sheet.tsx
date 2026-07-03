"use client";

// Spec 116 + the spec-117 UX round — the create-PO form. Buyer selected N approved
// tickets on the desktop grid; this RIGHT-SIDE panel (desktop, matching the review
// drawer — a bottom sheet was the wrong idiom) collects the supplier, a required
// ETA, and each line's price (live total), then calls create_purchase_order via the
// createPurchaseOrder action. Suppliers can be added inline (no dead-end). On
// success a toast confirms and the grid refreshes.
//
// 'use client': controlled inputs + pending state + inline supplier create. A child
// of the (client) ProcurementGrid — all props are client→client, no server closures.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, X } from "lucide-react";
import { bahtWithSymbol as baht } from "@/lib/format";
import { CREATE_PO_LABEL } from "@/lib/i18n/labels";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { RadioChip } from "@/components/features/common/radio-chip";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  BUTTON_SECONDARY_MUTED,
  FIELD_INPUT,
  FIELD_SELECT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { PO_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";
import { buildPoAttachmentStoragePath } from "@/lib/purchasing/po-attachment-path";
import {
  ATTACHMENT_ACCEPT_MIME,
  attachmentExtToMime,
  isPdfMime,
  type AttachmentExt,
} from "@/lib/purchasing/attachment-file";
import {
  addPurchaseOrderAttachment,
  addPurchaseOrderCharge,
  createPurchaseOrder,
  createSupplier,
} from "@/app/requests/actions";
import {
  purchaseOrderGrandTotal,
  purchaseOrderTotal,
  type PoChargeType,
} from "@/lib/purchasing/purchase-order";
import {
  ADD_PO_CHARGE_LABEL,
  PO_CHARGES_SECTION_LABEL,
  PO_CHARGE_TYPE_LABEL,
  PO_GRAND_TOTAL_LABEL,
} from "@/lib/i18n/labels";
import {
  VAT_RATE,
  type VatMode,
  rateForMode,
  grossFromEntry,
  deriveVatBreakdown,
} from "@/lib/purchasing/vat";
import type { SupplierOption } from "@/components/features/purchasing/purchase-record-form";

export interface CreatePoLine {
  id: string;
  pr_number: number | null;
  item_description: string;
  quantity: number;
  unit: string;
  wp_code: string | null;
}

// Spec 260 — a draft PO-level charge row in the create sheet (its own VAT mode,
// independent of the PO lines' rate). Resolved to gross + rate on submit.
interface DraftCharge {
  id: string;
  type: PoChargeType;
  amount: string;
  vatMode: VatMode;
  note: string;
}

const PO_CHARGE_TYPES: PoChargeType[] = ["transport", "discount", "other"];

// A draft row's resolved gross (or null if the amount isn't a positive number).
function draftChargeGross(ch: DraftCharge): number | null {
  const n = Number(ch.amount.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return grossFromEntry(n, ch.vatMode, rateForMode(ch.vatMode));
}

const FIELD_DATE =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 appearance-none border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const FIELD_PRICE =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-28 min-w-0 border px-3 text-right text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const ZOOM_BTN =
  "border-edge-strong bg-card text-ink hover:bg-sunk focus-visible:ring-action inline-flex size-8 items-center justify-center rounded-md border text-base leading-none font-medium focus:outline-none focus-visible:ring-2 disabled:opacity-50";

export function CreatePurchaseOrderSheet({
  open,
  lines,
  suppliers,
  onClose,
  onCreated,
  onRemoveLine,
  defaultSupplierId,
  defaultAmounts,
}: {
  open: boolean;
  lines: ReadonlyArray<CreatePoLine>;
  suppliers: ReadonlyArray<SupplierOption>;
  onClose: () => void;
  onCreated: () => void;
  // Spec 118 (phone basket): drop a line from the order inside the sheet.
  onRemoveLine?: (id: string) => void;
  // Spec 182 U2: prefill from a picked quote (supplier + each line's net price).
  // Seeded into the initial state — the caller remounts (key) on a new pick.
  defaultSupplierId?: string | undefined;
  defaultAmounts?: Record<string, string> | undefined;
}) {
  const router = useRouter();
  const toast = useToast();
  // Spec 125: an optional source document (quotation/invoice) attached at PO
  // creation — kept client-side, uploaded after create_purchase_order returns
  // the po_id (ADR 0046 upload-on-submit; resolves the no-po_id-yet problem).
  const docInputRef = useRef<HTMLInputElement>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  // Spec 126: phone doc⇄form toggle (lg+ shows both side-by-side). A fresh
  // attach lands on the doc so the buyer confirms it loaded, then taps ฟอร์ม.
  const [docTab, setDocTab] = useState<"doc" | "form">("doc");
  // Client-side object-URL preview — NO upload yet (ADR 0046 decision 3: read
  // the doc while filling; the bytes upload on submit). Revoked on change/unmount.
  const docUrl = useMemo(() => (docFile ? URL.createObjectURL(docFile) : null), [docFile]);
  useEffect(() => {
    return () => {
      if (docUrl) URL.revokeObjectURL(docUrl);
    };
  }, [docUrl]);
  const docIsPdf = docFile ? isPdfMime(docFile.type) : false;
  // Spec 126 follow-up: inline zoom for the IMAGE preview (PDFs already zoom via
  // the browser's built-in viewer). 1× = fit-to-width; up to 4×, scroll to pan.
  // Reset is done in the file-change handler (a setState-in-effect trips the
  // React Compiler lint — the recurring rule).
  const [imgZoom, setImgZoom] = useState(1);
  const [supplierId, setSupplierId] = useState(defaultSupplierId ?? "");
  const [eta, setEta] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>(defaultAmounts ?? {});
  // Default exclusive (ก่อน VAT): a PO is created from a quotation, and Thai
  // quotes are usually quoted ex-VAT (net + 7%) — spec 120 review.
  const [vatMode, setVatMode] = useState<VatMode>("exclusive");
  const [orderRef, setOrderRef] = useState("");
  // Spec 260 — optional PO-level charge rows (transport/discount/other), each
  // with its own amount + VAT mode + note. Submitted as add_purchase_order_charge
  // calls right after create_purchase_order succeeds (the PO must exist first).
  const [charges, setCharges] = useState<DraftCharge[]>([]);
  const [nameDraft, setNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [createdSuppliers, setCreatedSuppliers] = useState<SupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Freshly-created suppliers, deduped against the server-supplied list.
  const allSuppliers = [
    ...suppliers,
    ...createdSuppliers.filter((c) => !suppliers.some((s) => s.id === c.id)),
  ];

  // Spec 119: one VAT mode for the whole PO (one supplier). Each line's entered
  // price resolves to the GROSS via the mode; the total breaks down for display.
  const rate = rateForMode(vatMode);
  const grossTotal = useMemo(
    () =>
      purchaseOrderTotal(
        lines.map((l) => {
          const raw = (amounts[l.id] ?? "").trim();
          if (raw === "") return null;
          const n = Number(raw);
          return Number.isFinite(n) ? grossFromEntry(n, vatMode, rate) : null;
        }),
      ),
    [lines, amounts, vatMode, rate],
  );
  const breakdown = deriveVatBreakdown(grossTotal, rate);

  // Spec 260 — live grand-total preview: line gross total + transport/other −
  // discount, as charge rows are typed. Only rows with a valid amount count.
  const chargePreview = useMemo(
    () =>
      charges
        .map((ch) => {
          const gross = draftChargeGross(ch);
          return gross === null ? null : { charge_type: ch.type, amount: gross };
        })
        .filter((c): c is { charge_type: PoChargeType; amount: number } => c !== null),
    [charges],
  );
  const grandTotal = purchaseOrderGrandTotal([grossTotal], chargePreview);

  const ready = supplierId !== "" && eta.trim() !== "" && lines.length > 0;

  function handleAddSupplier() {
    setError(null);
    startTransition(async () => {
      const created = await createSupplier({ name: nameDraft, phone: phoneDraft });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setCreatedSuppliers((prev) => [
        ...prev,
        { id: created.id, name: nameDraft.trim(), phone: phoneDraft.trim() || null },
      ]);
      setSupplierId(created.id);
      setNameDraft("");
      setPhoneDraft("");
    });
  }

  // Spec 125 / ADR 0046: upload the source doc AFTER the PO exists. PDFs upload
  // raw (the spec-34 downscale pipeline is photo-only); images are prepared.
  // Returns false on any failure — the caller treats it as non-fatal (the PO is
  // already created; the doc is optional, no re-attach surface yet = a seam).
  async function uploadPoDocument(poId: string, file: File): Promise<boolean> {
    let blob: Blob;
    let ext: AttachmentExt;
    if (isPdfMime(file.type)) {
      blob = file;
      ext = "pdf";
    } else {
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) return false;
      blob = prepared.blob;
      ext = prepared.ext;
    }
    const attachmentId = crypto.randomUUID();
    const path = buildPoAttachmentStoragePath(poId, attachmentId, ext);
    if (!path) return false;
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(PO_ATTACHMENTS_BUCKET)
      .upload(path, blob, { upsert: false, contentType: attachmentExtToMime(ext) });
    if (uploadError) return false;
    try {
      const res = await addPurchaseOrderAttachment({ purchaseOrderId: poId, attachmentId, ext });
      return res.ok;
    } catch {
      return false;
    }
  }

  function handleSubmit() {
    setError(null);
    const parsedLines: Array<{ requestId: string; amount: number | null }> = [];
    for (const l of lines) {
      const raw = (amounts[l.id] ?? "").trim();
      let amount: number | null = null;
      if (raw !== "") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          setError(`ราคาของ "${l.item_description}" ไม่ถูกต้อง`);
          return;
        }
        amount = grossFromEntry(n, vatMode, rate);
      }
      parsedLines.push({ requestId: l.id, amount });
    }

    // Spec 260 — validate the optional charge rows. An empty row is skipped; a
    // row with a bad amount or an 'other' with no note blocks submit.
    const chargeSubs: Array<{
      chargeType: PoChargeType;
      amount: number;
      vatRate: number;
      note: string | null;
    }> = [];
    for (const ch of charges) {
      const gross = draftChargeGross(ch);
      if (gross === null) {
        if (ch.amount.trim() !== "") {
          setError("จำนวนค่าใช้จ่ายไม่ถูกต้อง");
          return;
        }
        continue;
      }
      if (ch.type === "other" && ch.note.trim() === "") {
        setError("กรุณาระบุรายละเอียดสำหรับค่าใช้จ่ายอื่น");
        return;
      }
      chargeSubs.push({
        chargeType: ch.type,
        amount: gross,
        vatRate: rateForMode(ch.vatMode),
        note: ch.note.trim() === "" ? null : ch.note,
      });
    }

    startTransition(async () => {
      const result = await createPurchaseOrder({
        supplierId,
        eta: eta.trim() === "" ? null : eta,
        lines: parsedLines,
        vatRate: rate,
        orderRef,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Upload-on-submit: the PO now exists (poId) — attach the source doc.
      // A failed doc upload is non-fatal (the PO stands; the doc is optional).
      const docOk = docFile ? await uploadPoDocument(result.poId, docFile) : true;
      // Spec 260 — record the charges now that the PO exists (sequential). A
      // failed charge is non-fatal: the PO stands and the charge is re-addable
      // from the PO detail (surfaced in the toast, the doc-upload precedent).
      let chargesOk = true;
      for (const cs of chargeSubs) {
        const r = await addPurchaseOrderCharge({ poId: result.poId, ...cs });
        if (!r.ok) {
          chargesOk = false;
          break;
        }
      }
      const notes: string[] = [];
      if (!docOk) notes.push("แนบเอกสารไม่สำเร็จ");
      if (!chargesOk) notes.push("บางค่าใช้จ่ายไม่สำเร็จ");
      toast.success(
        `สร้างใบสั่งซื้อสำเร็จ · ${lines.length} รายการ${notes.length ? ` (${notes.join(", ")})` : ""}`,
      );
      onCreated();
      router.refresh();
    });
  }

  // Spec 260 — charge-row helpers for the optional charges section.
  const addChargeRow = () =>
    setCharges((p) => [
      ...p,
      { id: crypto.randomUUID(), type: "transport", amount: "", vatMode: "exclusive", note: "" },
    ]);
  const updateChargeRow = (id: string, patch: Partial<DraftCharge>) =>
    setCharges((p) => p.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeChargeRow = (id: string) => setCharges((p) => p.filter((c) => c.id !== id));

  // Spec 126 (ADR 0046 Layer B): the attached doc, shown as a side-by-side
  // reference on lg+ (doc⇄form toggle on phone). Preview is a client object URL
  // — the bytes upload on submit (Unit 1's uploadPoDocument).
  const docPane = docFile ? (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <FileText aria-hidden className="text-ink-muted size-4 shrink-0" />
        <span className="text-ink min-w-0 flex-1 truncate">{docFile.name}</span>
        {docUrl ? (
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-action shrink-0 font-medium underline-offset-2 hover:underline"
          >
            เปิด
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => docInputRef.current?.click()}
          disabled={pending}
          className="text-action shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-60"
        >
          เปลี่ยน
        </button>
        <button
          type="button"
          onClick={() => {
            setDocFile(null);
            setDocTab("doc");
            if (docInputRef.current) docInputRef.current.value = "";
          }}
          disabled={pending}
          className="text-ink-muted hover:text-danger shrink-0 font-medium disabled:opacity-60"
        >
          นำออก
        </button>
      </div>
      {docUrl ? (
        docIsPdf ? (
          <iframe
            src={`${docUrl}#view=Fit`}
            title={docFile.name}
            className="border-edge bg-sunk h-[82vh] w-full rounded-md border"
          />
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setImgZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
                disabled={imgZoom <= 1}
                aria-label="ซูมออก"
                className={ZOOM_BTN}
              >
                −
              </button>
              <span className="text-ink-muted w-12 text-center text-xs tabular-nums">
                {Math.round(imgZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setImgZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                disabled={imgZoom >= 4}
                aria-label="ซูมเข้า"
                className={ZOOM_BTN}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setImgZoom(1)}
                className="text-action ml-1 text-xs font-medium underline-offset-2 hover:underline"
              >
                พอดี
              </button>
            </div>
            <div className="border-edge bg-sunk h-[82vh] w-full overflow-auto rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object-URL preview, not a remote asset */}
              <img
                src={docUrl}
                alt={docFile.name}
                style={{ width: `${imgZoom * 100}%` }}
                className="mx-auto block h-auto max-w-none"
              />
            </div>
          </div>
        )
      ) : null}
    </div>
  ) : null;

  const attachButton = (
    <button
      type="button"
      onClick={() => docInputRef.current?.click()}
      disabled={pending}
      className={BUTTON_SECONDARY_MUTED}
    >
      แนบใบเสนอราคา / ใบแจ้งหนี้ (ไม่บังคับ)
    </button>
  );

  return (
    <BottomSheet
      open={open}
      side="right"
      wide={docFile !== null}
      title={CREATE_PO_LABEL}
      onClose={onClose}
    >
      <input
        ref={docInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT_MIME}
        className="sr-only"
        onChange={(e) => {
          setDocFile(e.target.files?.[0] ?? null);
          setDocTab("doc");
          setImgZoom(1);
        }}
        disabled={pending}
      />
      <div
        className={
          docFile
            ? "flex flex-col gap-3 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start lg:gap-4"
            : "flex flex-col gap-3"
        }
      >
        {docFile ? (
          <>
            <div className="flex gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setDocTab("doc")}
                aria-pressed={docTab === "doc"}
                className={`rounded-control flex-1 border px-3 py-1.5 text-xs font-medium ${
                  docTab === "doc"
                    ? "border-action bg-action-soft text-action"
                    : "border-edge-strong bg-card text-ink-muted"
                }`}
              >
                เอกสาร
              </button>
              <button
                type="button"
                onClick={() => setDocTab("form")}
                aria-pressed={docTab === "form"}
                className={`rounded-control flex-1 border px-3 py-1.5 text-xs font-medium ${
                  docTab === "form"
                    ? "border-action bg-action-soft text-action"
                    : "border-edge-strong bg-card text-ink-muted"
                }`}
              >
                ฟอร์ม
              </button>
            </div>
            <div className={docTab === "doc" ? "" : "hidden lg:block"}>{docPane}</div>
          </>
        ) : null}
        <div className={docFile ? (docTab === "form" ? "" : "hidden lg:block") : ""}>
          <div className="flex flex-col gap-3">
            {!docFile ? attachButton : null}
            <p className="text-ink-muted text-meta">รวม {lines.length} รายการเป็นใบสั่งซื้อเดียว</p>

            <label htmlFor="po-supplier" className="text-ink text-xs font-medium">
              ผู้ขาย
            </label>
            <select
              id="po-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={pending}
              className={FIELD_SELECT}
            >
              <option value="">— เลือกผู้ขาย —</option>
              {allSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.phone ? ` · ${s.phone}` : ""}
                </option>
              ))}
            </select>

            <details>
              <summary className="text-action cursor-pointer text-xs font-medium underline-offset-2 hover:underline">
                เพิ่มผู้ขายใหม่
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <input
                  type="text"
                  value={nameDraft}
                  maxLength={200}
                  onChange={(e) => setNameDraft(e.target.value)}
                  disabled={pending}
                  placeholder="ชื่อผู้ขาย / ร้านค้า"
                  className={FIELD_INPUT}
                />
                <input
                  type="tel"
                  value={phoneDraft}
                  maxLength={50}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  disabled={pending}
                  placeholder="เบอร์โทร (ไม่บังคับ)"
                  className={FIELD_INPUT}
                />
                <button
                  type="button"
                  onClick={handleAddSupplier}
                  disabled={pending || nameDraft.trim().length === 0}
                  className={BUTTON_SECONDARY}
                >
                  {pending ? "กำลังบันทึก…" : "เพิ่มและเลือก"}
                </button>
              </div>
            </details>

            <div className="flex items-center gap-1.5">
              <label htmlFor="po-eta" className="text-ink text-xs font-medium">
                คาดว่าจะได้รับของ
              </label>
              <span className="bg-attn-soft text-attn-ink rounded-full px-1.5 text-[10px] font-semibold">
                จำเป็น
              </span>
            </div>
            <input
              id="po-eta"
              type="date"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              disabled={pending}
              className={FIELD_DATE}
            />

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-ink mb-1 text-xs font-medium">
                VAT (ภาษีมูลค่าเพิ่ม {VAT_RATE}%)
              </legend>
              <div className="flex flex-wrap gap-2">
                <RadioChip
                  name="po-vat"
                  label="ก่อน VAT"
                  checked={vatMode === "exclusive"}
                  onSelect={() => setVatMode("exclusive")}
                />
                <RadioChip
                  name="po-vat"
                  label="รวม VAT แล้ว"
                  checked={vatMode === "inclusive"}
                  onSelect={() => setVatMode("inclusive")}
                />
                <RadioChip
                  name="po-vat"
                  label="ไม่มี VAT"
                  checked={vatMode === "none"}
                  onSelect={() => setVatMode("none")}
                />
              </div>
            </fieldset>

            <label htmlFor="po-order-ref" className="text-ink text-xs font-medium">
              เลขอ้างอิงผู้ขาย (ไม่บังคับ)
            </label>
            <input
              id="po-order-ref"
              type="text"
              value={orderRef}
              maxLength={80}
              onChange={(e) => setOrderRef(e.target.value)}
              disabled={pending}
              className={FIELD_INPUT}
            />

            <div className="rounded-control border-edge divide-edge flex flex-col divide-y border">
              {lines.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink text-sm font-medium break-words">{l.item_description}</p>
                    <p className="text-ink-muted text-meta">
                      {l.pr_number ? (
                        <span className="font-mono">{formatPrNumber(l.pr_number)} · </span>
                      ) : null}
                      {l.wp_code ? <span className="font-mono">{l.wp_code} · </span> : null}
                      {l.quantity} {l.unit}
                    </p>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={amounts[l.id] ?? ""}
                    onChange={(e) => setAmounts((p) => ({ ...p, [l.id]: e.target.value }))}
                    disabled={pending}
                    placeholder="฿ ราคา"
                    aria-label={`ราคาของ ${l.item_description}`}
                    className={FIELD_PRICE}
                  />
                  {onRemoveLine ? (
                    <button
                      type="button"
                      onClick={() => onRemoveLine(l.id)}
                      disabled={pending}
                      aria-label={`นำ ${l.item_description} ออกจากใบสั่งซื้อ`}
                      className="text-ink-muted hover:text-danger focus-visible:ring-action inline-flex size-11 shrink-0 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {rate > 0 ? (
                <>
                  <div className="text-meta text-ink-muted flex items-baseline justify-between">
                    <span>ก่อน VAT</span>
                    <span className="tabular-nums">{baht(breakdown.net)}</span>
                  </div>
                  <div className="text-meta text-ink-muted flex items-baseline justify-between">
                    <span>VAT {rate}%</span>
                    <span className="tabular-nums">{baht(breakdown.vat)}</span>
                  </div>
                </>
              ) : null}
              <div className="flex items-baseline justify-between">
                <span className="text-ink-muted text-xs">ยอดรวม{rate > 0 ? " (รวม VAT)" : ""}</span>
                <span className="text-ink text-base font-semibold tabular-nums">
                  {baht(breakdown.gross)}
                </span>
              </div>
            </div>

            {/* Spec 260 — optional PO-level charges (ค่าขนส่ง / ส่วนลด / อื่นๆ). Each
                row carries its own amount + VAT mode + note; the grand total below
                previews line total + transport/other − discount as rows are typed.
                Submitted as add_purchase_order_charge calls after the PO is created. */}
            <div className="border-edge-strong flex flex-col gap-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink text-xs font-medium">{PO_CHARGES_SECTION_LABEL}</span>
                <button
                  type="button"
                  onClick={addChargeRow}
                  disabled={pending}
                  className="text-action text-xs font-medium underline-offset-2 hover:underline disabled:opacity-60"
                >
                  + {ADD_PO_CHARGE_LABEL}
                </button>
              </div>

              {charges.map((ch) => (
                <div
                  key={ch.id}
                  className="rounded-control border-edge flex flex-col gap-2 border p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {PO_CHARGE_TYPES.map((t) => (
                        <RadioChip
                          key={t}
                          name={`charge-type-${ch.id}`}
                          label={PO_CHARGE_TYPE_LABEL[t]}
                          checked={ch.type === t}
                          onSelect={() => updateChargeRow(ch.id, { type: t })}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeChargeRow(ch.id)}
                      disabled={pending}
                      aria-label="นำค่าใช้จ่ายนี้ออก"
                      className="text-ink-muted hover:text-danger focus-visible:ring-action ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={ch.amount}
                      onChange={(e) => updateChargeRow(ch.id, { amount: e.target.value })}
                      disabled={pending}
                      placeholder="฿ จำนวนเงิน"
                      aria-label={`จำนวนเงิน ${PO_CHARGE_TYPE_LABEL[ch.type]}`}
                      className={FIELD_PRICE}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <RadioChip
                        name={`charge-vat-${ch.id}`}
                        label="ก่อน VAT"
                        checked={ch.vatMode === "exclusive"}
                        onSelect={() => updateChargeRow(ch.id, { vatMode: "exclusive" })}
                      />
                      <RadioChip
                        name={`charge-vat-${ch.id}`}
                        label="รวม VAT"
                        checked={ch.vatMode === "inclusive"}
                        onSelect={() => updateChargeRow(ch.id, { vatMode: "inclusive" })}
                      />
                      <RadioChip
                        name={`charge-vat-${ch.id}`}
                        label="ไม่มี VAT"
                        checked={ch.vatMode === "none"}
                        onSelect={() => updateChargeRow(ch.id, { vatMode: "none" })}
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    value={ch.note}
                    maxLength={500}
                    onChange={(e) => updateChargeRow(ch.id, { note: e.target.value })}
                    disabled={pending}
                    placeholder={
                      ch.type === "other" ? "ระบุค่าใช้จ่าย (จำเป็น)" : "หมายเหตุ (ไม่บังคับ)"
                    }
                    aria-label={`รายละเอียด ${PO_CHARGE_TYPE_LABEL[ch.type]}`}
                    className={FIELD_INPUT}
                  />
                </div>
              ))}

              {charges.length > 0 ? (
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-ink text-sm font-medium">{PO_GRAND_TOTAL_LABEL}</span>
                  <span className="text-ink text-base font-semibold tabular-nums">
                    {baht(grandTotal)}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className={BUTTON_SECONDARY}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={pending || !ready}
                className={BUTTON_PRIMARY}
              >
                {pending ? "กำลังสร้าง…" : `${CREATE_PO_LABEL} (${lines.length})`}
              </button>
            </div>

            {!ready && !pending ? (
              <p className="text-ink-muted text-meta text-right">
                เลือกผู้ขายและระบุวันที่ก่อนสร้าง
              </p>
            ) : null}

            {error ? (
              <p role="alert" className={INLINE_ALERT_TEXT}>
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
