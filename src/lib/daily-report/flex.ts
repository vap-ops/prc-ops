// Spec 212 — build the SA daily report as a LINE Flex Message. Pure: takes a
// DailyReportView and returns the LINE Flex bubble (and a push-ready message).
//
// FLEXIBLE BY DESIGN (operator: "keep the report flexible, review and change as
// needed"): the bubble body is composed from small section builders over the
// view — reorder/add/remove a section by editing `bodyContents()`; restyle by
// editing the `C` palette. No caller knows the layout. `altText` is the text
// fallback LINE shows in notifications / on unsupported clients.

export type WorkerType = "company" | "dc" | "subcon";

export interface DailyReportWorker {
  name: string;
  type: WorkerType;
}

export interface DailyReportException {
  name: string;
  kind: "late" | "ot" | "early";
  /** Human detail, e.g. "มา 09:30" or "+2 ชม." */
  detail: string;
}

export interface DailyReportEntry {
  /** The work done — a WP name ("ฐานราก") or a free label ("เก็บงานทั่วไป"). */
  title: string;
  /** Work-package / deliverable code ("D03"), or null for general site work. */
  wpCode: string | null;
  narrative: string;
  /** The identified crew — every person, because daily pay needs the names. */
  workers: DailyReportWorker[];
  exceptions: DailyReportException[];
}

export interface DailyReportView {
  projectName: string;
  /** Preformatted, e.g. "เสาร์ 27/06/2026". */
  dateLabel: string;
  status: "draft" | "submitted" | "confirmed";
  /** e.g. "08:00–17:00". */
  standardHoursLabel: string;
  headcountByType: { company: number; dc: number; subcon: number };
  lateCount: number;
  otCount: number;
  photoCount: number;
  entries: DailyReportEntry[];
  problems: string | null;
  nextDayPlan: string | null;
  /** e.g. "ส่งโดย สมชาย (SA) · 17:32", or null. */
  footerLabel: string | null;
}

// --- palette (one place to restyle) ---------------------------------------
const C = {
  brand: "#06C755",
  onBrand: "#FFFFFF",
  onBrandDim: "#E4F8EC",
  ink: "#222222",
  inkSecondary: "#666666",
  inkMuted: "#999999",
  sep: "#EEEEEE",
  tagBg: "#F0F0F0",
  tagInk: "#5F5E5A",
  wpBg: "#E6F1FB",
  wpInk: "#185FA5",
  lateBg: "#FBF0DA",
  lateInk: "#9A6A00",
  otBg: "#E6F1FB",
  otInk: "#185FA5",
} as const;

const STATUS_LABEL: Record<DailyReportView["status"], string> = {
  draft: "ฉบับร่าง",
  submitted: "รอยืนยัน",
  confirmed: "ยืนยันแล้ว",
};

const TYPE_LABEL: Record<WorkerType, string> = {
  company: "บริษัท",
  dc: "DC",
  subcon: "ผู้รับเหมา",
};

// --- minimal LINE Flex component types ------------------------------------
type FlexText = {
  type: "text";
  text: string;
  size?: string;
  color?: string;
  weight?: "regular" | "bold";
  wrap?: boolean;
  flex?: number;
  margin?: string;
  align?: "start" | "end" | "center";
};
type FlexBox = {
  type: "box";
  layout: "vertical" | "horizontal" | "baseline";
  contents: FlexComponent[];
  spacing?: string;
  margin?: string;
  backgroundColor?: string;
  cornerRadius?: string;
  paddingAll?: string;
  paddingStart?: string;
  paddingEnd?: string;
  paddingTop?: string;
  paddingBottom?: string;
  flex?: number;
};
type FlexSeparator = { type: "separator"; margin?: string; color?: string };
type FlexFiller = { type: "filler" };
type FlexComponent = FlexText | FlexBox | FlexSeparator | FlexFiller;

export type FlexBubble = {
  type: "bubble";
  header: FlexBox;
  body: FlexBox;
};

// --- small builders --------------------------------------------------------
function txt(text: string, opts: Omit<FlexText, "type" | "text"> = {}): FlexText {
  return { type: "text", text, ...opts };
}

function pill(label: string, bg: string, ink: string): FlexBox {
  return {
    type: "box",
    layout: "baseline",
    backgroundColor: bg,
    cornerRadius: "12px",
    paddingStart: "8px",
    paddingEnd: "8px",
    paddingTop: "2px",
    paddingBottom: "2px",
    contents: [txt(label, { size: "xs", color: ink })],
  };
}

function sep(): FlexSeparator {
  return { type: "separator", margin: "lg", color: C.sep };
}

function labeledRow(label: string, value: string): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    spacing: "xs",
    contents: [
      txt(label, { size: "xs", color: C.inkSecondary }),
      txt(value, { size: "sm", color: C.ink, wrap: true }),
    ],
  };
}

// A work entry: title + WP chip, narrative, the identified crew by type, and the
// late/OT exceptions called out by name.
function entrySection(entry: DailyReportEntry): FlexComponent {
  const typeChips: FlexComponent[] = (["company", "dc", "subcon"] as WorkerType[])
    .map((t) => ({ t, n: entry.workers.filter((w) => w.type === t).length }))
    .filter((x) => x.n > 0)
    .map((x) => pill(`${TYPE_LABEL[x.t]} ${x.n}`, C.tagBg, C.tagInk));

  const wpChip = entry.wpCode
    ? pill(entry.wpCode, C.wpBg, C.wpInk)
    : pill("ไม่ผูก WP", C.tagBg, C.inkMuted);

  const names = entry.workers.map((w) => w.name).join(" · ");

  const exceptionRows: FlexComponent[] = entry.exceptions.map((e) => ({
    type: "box",
    layout: "baseline",
    margin: "sm",
    spacing: "sm",
    contents: [
      e.kind === "late"
        ? pill("สาย", C.lateBg, C.lateInk)
        : e.kind === "early"
          ? pill("ออกก่อน", C.lateBg, C.lateInk)
          : pill("OT", C.otBg, C.otInk),
      txt(`${e.name} · ${e.detail}`, { size: "sm", color: C.ink, flex: 5, wrap: true }),
    ],
  }));

  return {
    type: "box",
    layout: "vertical",
    margin: "lg",
    spacing: "xs",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          txt(entry.title, { size: "md", weight: "bold", color: C.ink, flex: 5 }),
          { type: "box", layout: "baseline", flex: 0, contents: [wpChip] },
        ],
      },
      { type: "box", layout: "horizontal", spacing: "xs", margin: "xs", contents: typeChips },
      txt(entry.narrative, { size: "sm", color: C.inkSecondary, wrap: true }),
      txt(names, { size: "sm", color: C.ink, wrap: true, margin: "xs" }),
      ...exceptionRows,
    ],
  };
}

function summarySection(view: DailyReportView): FlexComponent {
  const { company, dc, subcon } = view.headcountByType;
  const total = company + dc + subcon;
  const chips: FlexComponent[] = [];
  if (dc > 0) chips.push(pill(`DC ${dc}`, C.tagBg, C.tagInk));
  if (subcon > 0) chips.push(pill(`ผู้รับเหมา ${subcon}`, C.tagBg, C.tagInk));
  if (company > 0) chips.push(pill(`บริษัท ${company}`, C.tagBg, C.tagInk));
  if (view.lateCount > 0) chips.push(pill(`สาย ${view.lateCount}`, C.lateBg, C.lateInk));
  if (view.otCount > 0) chips.push(pill(`OT ${view.otCount}`, C.otBg, C.otInk));
  if (view.photoCount > 0) chips.push(pill(`รูป ${view.photoCount}`, C.tagBg, C.tagInk));

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      txt(`เข้างาน ${total} คน`, { size: "md", weight: "bold", color: C.ink }),
      { type: "box", layout: "horizontal", spacing: "xs", contents: chips },
      txt(`เวลามาตรฐาน ${view.standardHoursLabel}`, { size: "xs", color: C.inkMuted }),
    ],
  };
}

function bodyContents(view: DailyReportView): FlexComponent[] {
  const out: FlexComponent[] = [summarySection(view), sep()];
  out.push(txt("งานวันนี้", { size: "xs", color: C.inkMuted }));
  view.entries.forEach((e) => out.push(entrySection(e)));
  if (view.problems) {
    out.push(sep());
    out.push(labeledRow("ปัญหาที่พบ", view.problems));
  }
  if (view.nextDayPlan) {
    if (!view.problems) out.push(sep());
    out.push(labeledRow("แผนงานพรุ่งนี้", view.nextDayPlan));
  }
  if (view.footerLabel) {
    out.push(sep());
    out.push(txt(view.footerLabel, { size: "xs", color: C.inkMuted }));
  }
  return out;
}

export function dailyReportBubble(view: DailyReportView): FlexBubble {
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: C.brand,
      paddingAll: "16px",
      spacing: "xs",
      contents: [
        txt("รายงานประจำวัน", { size: "xs", color: C.onBrandDim }),
        txt(view.projectName, { size: "lg", weight: "bold", color: C.onBrand, wrap: true }),
        {
          type: "box",
          layout: "horizontal",
          contents: [
            txt(view.dateLabel, { size: "sm", color: C.onBrandDim, flex: 5 }),
            {
              type: "box",
              layout: "baseline",
              flex: 0,
              contents: [pill(STATUS_LABEL[view.status], C.onBrand, C.brand)],
            },
          ],
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      contents: bodyContents(view),
    },
  };
}

// Text fallback (notification preview + the existing text-only push path).
export function dailyReportAltText(view: DailyReportView): string {
  const { company, dc, subcon } = view.headcountByType;
  const lines = [
    `รายงานประจำวัน ${view.projectName}`,
    `${view.dateLabel} · ${STATUS_LABEL[view.status]}`,
    `เข้างาน ${company + dc + subcon} คน (DC ${dc} · ผู้รับเหมา ${subcon} · บริษัท ${company})`,
  ];
  for (const e of view.entries) {
    lines.push(
      `• ${e.title}${e.wpCode ? ` [${e.wpCode}]` : ""}: ${e.narrative} — ${e.workers.length} คน`,
    );
    for (const x of e.exceptions) lines.push(`   - ${x.name} ${x.detail}`);
  }
  if (view.problems) lines.push(`ปัญหา: ${view.problems}`);
  if (view.nextDayPlan) lines.push(`พรุ่งนี้: ${view.nextDayPlan}`);
  return lines.join("\n");
}

export function dailyReportFlexMessage(view: DailyReportView): {
  type: "flex";
  altText: string;
  contents: FlexBubble;
} {
  return { type: "flex", altText: dailyReportAltText(view), contents: dailyReportBubble(view) };
}
