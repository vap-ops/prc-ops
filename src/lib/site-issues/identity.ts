// Spec 277 P1a — site-issue identity: the ordered type list + per-type icon for
// the แจ้งปัญหา report picker and the ปัญหาวันนี้ section. The DB enum
// (site_issue_type) is the SSOT for the set; this adds presentation only. Thai
// labels live in labels.ts (the label SSOT).

import type { LucideIcon } from "lucide-react";
import { CloudRain, Wrench, ShieldAlert, Ban, CircleAlert } from "lucide-react";
import type { Database } from "@/lib/db/database.types";

export type SiteIssueType = Database["public"]["Enums"]["site_issue_type"];
export type SiteIssueStatus = Database["public"]["Enums"]["site_issue_status"];

// Report-picker order: the two most common site-pause causes first (the feedback's
// "machines breaking down or rains"), then the serious pair, then the catch-all.
export const SITE_ISSUE_TYPES: readonly SiteIssueType[] = [
  "weather",
  "equipment",
  "safety",
  "access",
  "other",
];

export const SITE_ISSUE_TYPE_ICON: Record<SiteIssueType, LucideIcon> = {
  weather: CloudRain,
  equipment: Wrench,
  safety: ShieldAlert,
  access: Ban,
  other: CircleAlert,
};
