# Spec 126 — Document-first create-PO surface (ADR 0046 Layer B, Unit 2)

**Status:** building 2026-06-16. **ADR:** 0046 (decision 4). **Builds on:** spec 125 (PO source-doc data
layer + upload-on-submit) + spec 116/117 (the create-PO sheet). **Driver:** ADR 0046 — "on a bigger
screen preview the doc SIDE-BY-SIDE as reference to fill the form." Spec 125 added the doc picker +
upload-on-submit but only a filename chip; this unit makes the doc a **readable reference while filling**.

**Operator decisions (this unit):** container = **wide modal** (over a dedicated route — preserves the
in-memory ticket selection from all 3 entry points: desktop grid, phone basket, single-ticket button);
flow = **attach-inside-expands** (open as today → attach a doc → the surface expands to the split; no doc
→ the plain narrow form). Mockup approved 2026-06-16. **No schema** — pure client/UI on Unit 1's table.

## What ships

- **`BottomSheet` gains `wide?`** — a RIGHT panel grows `max-w-md → lg:max-w-5xl` when set (no effect on
  the bottom variant; phone uses an in-panel toggle). The create-PO sheet passes `wide={docFile != null}`.
- **Client-side object-URL preview** (ADR 0046 decision 3 — no upload while filling): when a doc is
  attached, the sheet shows it — **PDF via `<iframe>`, image via `<img>`** (a local `blob:` object URL,
  revoked on change/unmount). The bytes still upload **on submit** (spec 125's `uploadPoDocument`).
- **Side-by-side on lg+, toggle on phone:** with a doc attached the sheet renders a 2-column split
  (`lg:grid-cols-[3fr_2fr]`) — doc left, form right. Below `lg` a **เอกสาร⇄ฟอร์ม toggle** swaps the two
  panes (a fresh attach lands on เอกสาร so the buyer confirms it loaded). No doc → the plain single-column
  form with an "แนบใบเสนอราคา / ใบแจ้งหนี้" button (the attach affordance moves into the doc pane —
  เปิด / เปลี่ยน / นำออก — once a doc is present).

## Scope

- **IN:** the `wide` BottomSheet variant; the object-URL preview (iframe/img); the responsive split +
  phone toggle; relocating the doc-attach affordance. All 3 entry points inherit it (shared sheet).
- **OUT:** any schema/RPC/bucket change (Unit 1 covers the write path); a dedicated route; multi-doc per
  PO; PO-doc removal/replace AFTER creation (a created PO has no detail surface yet — Unit 1 seam);
  AI extraction (Layer C); a PO detail page.

## Money posture

Unchanged. UI only; amounts/VAT untouched.

## Acceptance

A procurement user opens create-PO, attaches a PDF/photo quotation → on a tablet/PC the doc shows on the
left while they fill supplier/ETA/prices on the right; on phone they toggle เอกสาร⇄ฟอร์ม; submit creates
the PO and saves the doc (spec 125). No doc → the form is unchanged. (Procurement-gated, lg-only — not
preview-verifiable here; mockup-approved; acceptance = operator on the live deploy.)
