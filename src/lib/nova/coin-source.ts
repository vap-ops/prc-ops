// Spec 162 — Nova coin earn-sources (the coin_source enum, spec 160 U2).
// SSOT for the Thai labels: used by the award form AND the ledger display.
// Order puts behavior_bonus first — the discretionary recognition source the
// operator awards manually until the automatic earn-rules (spec 161 U5/U6) land.

import type { Database } from "@/lib/db/database.types";

export type CoinSource = Database["public"]["Enums"]["coin_source"];

export const COIN_SOURCE_LABEL: Record<CoinSource, string> = {
  behavior_bonus: "โบนัสพฤติกรรม",
  profit_share: "ส่วนแบ่งกำไร",
  savers_bonus: "โบนัสออม",
};

export const COIN_SOURCES: CoinSource[] = ["behavior_bonus", "profit_share", "savers_bonus"];
