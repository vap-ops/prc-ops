import type { DailyReportView } from "./flex";

// Spec 212 — a sample daily report (the operator's real TFM คำม่วง example,
// reshaped to the corrected model: grouped by work, each person identified +
// type-tagged, with a late case and OT cases). Drives the flex test and the
// "send a test bubble to my LINE" preview while we iterate on the layout.
export const SAMPLE_DAILY_REPORT: DailyReportView = {
  projectName: "TFM คำม่วง กาฬสินธุ์",
  dateLabel: "เสาร์ 27/06/2026",
  status: "submitted",
  standardHoursLabel: "08:00–17:00",
  headcountByType: { company: 0, dc: 8, subcon: 1 },
  lateCount: 1,
  otCount: 2,
  photoCount: 12,
  entries: [
    {
      title: "ฐานราก",
      wpCode: "D03",
      narrative: "เก็บงาน",
      workers: [{ name: "ช่างนัน", type: "subcon" }],
      exceptions: [{ name: "ช่างนัน", kind: "ot", detail: "+1 ชม." }],
    },
    {
      title: "เก็บงานทั่วไป",
      wpCode: null,
      narrative: "เก็บสีรอบๆ อาคาร เก็บงาน เคลียร์ของ",
      workers: [
        { name: "วีระชาต", type: "dc" },
        { name: "จันทร์", type: "dc" },
        { name: "โสภา", type: "dc" },
        { name: "อรปรีญา", type: "dc" },
        { name: "สมเพศ", type: "dc" },
        { name: "ยุทธชัย", type: "dc" },
        { name: "สุบิน", type: "dc" },
        { name: "วินัย", type: "dc" },
      ],
      exceptions: [
        { name: "อรปรีญา", kind: "late", detail: "มา 09:30" },
        { name: "ยุทธชัย", kind: "ot", detail: "+2 ชม." },
      ],
    },
  ],
  problems: "ฝนตกช่วงบ่าย งานสีหยุด ~1 ชม.",
  nextDayPlan: "เทคอนกรีตฐานราก F2–F4 · ทีมสีเก็บงานชั้น 2",
  footerLabel: "ส่งโดย สมชาย (SA) · 17:32",
};
