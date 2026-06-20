// Spec 161 U7 — Nova economic dials: the operator-facing SSOT for the editable
// nova_dials keys (set in U4a/U5/U6b as seeded placeholders) + the sell-rate
// levels (U1). Thai labels + display order for the calibration console. The dial
// VALUES live in the DB (nova_dials / sell_rate_table); this is just presentation.

import type { Database } from "@/lib/db/database.types";

export type WorkerLevel = Database["public"]["Enums"]["worker_level"];

// The dials, in display order, with a short Thai label + a one-line hint of what
// the placeholder means. The operator MUST calibrate every one before go-live.
export const NOVA_DIALS: { key: string; label: string; hint: string }[] = [
  {
    key: "coin_multiplier",
    label: "ตัวคูณเหรียญ",
    hint: "กำไร 1 บาท → กี่เหรียญ (ปรับตามอัตราการใช้งานจริง)",
  },
  {
    key: "ht_cut_pct",
    label: "ส่วนแบ่ง HT",
    hint: "สัดส่วนที่หัวหน้าช่างได้ก่อน (เช่น 0.15 = 15%)",
  },
  { key: "level_weight_senior", label: "น้ำหนัก อาวุโส", hint: "น้ำหนักการแบ่งของระดับอาวุโส" },
  { key: "level_weight_mid", label: "น้ำหนัก กลาง", hint: "น้ำหนักการแบ่งของระดับกลาง" },
  { key: "level_weight_junior", label: "น้ำหนัก ต้น", hint: "น้ำหนักการแบ่งของระดับต้น" },
  { key: "level_weight_apprentice", label: "น้ำหนัก ฝึกหัด", hint: "น้ำหนักการแบ่งของระดับฝึกหัด" },
  {
    key: "external_factor",
    label: "ตัวคูณภายนอก",
    hint: "น้ำหนักทีมงานภายนอก (น้อยกว่าระดับภายในเสมอ)",
  },
  {
    key: "vesting_tail_days",
    label: "ระยะสุกงอม (วัน)",
    hint: "ช่วงรับประกัน — เหรียญสุกงอมเป็นของทีมงาน",
  },
  {
    key: "savers_bonus_rate",
    label: "อัตราโบนัสออม",
    hint: "สัดส่วนโบนัสจากการถือเหรียญ (เช่น 0.02 = 2%)",
  },
];

export const WORKER_LEVEL_LABEL: Record<WorkerLevel, string> = {
  senior: "อาวุโส",
  mid: "กลาง",
  junior: "ต้น",
  apprentice: "ฝึกหัด",
};

export const WORKER_LEVEL_ORDER: WorkerLevel[] = ["senior", "mid", "junior", "apprentice"];
