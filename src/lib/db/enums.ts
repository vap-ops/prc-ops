// Canonical DB enum type aliases (spec 65). Previously each lib module
// re-derived its own alias from Database["public"]["Enums"]; this is the
// one home. Modules that exported an alias before spec 65 re-export from
// here so no import site breaks. Types only — nothing is emitted.

import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

export type UserRole = Enums["user_role"];
export type WorkPackageStatus = Enums["work_package_status"];
export type ProjectStatus = Enums["project_status"];
export type PhotoPhase = Enums["photo_phase"];
export type ApprovalDecision = Enums["approval_decision"];
export type ReportStatus = Enums["report_status"];
export type PurchaseRequestStatus = Enums["purchase_request_status"];
export type PurchaseRequestPriority = Enums["purchase_request_priority"];
