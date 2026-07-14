// Canonical DB enum type aliases (spec 65). Previously each lib module
// re-derived its own alias from Database["public"]["Enums"]; this is the
// one home. Modules that exported an alias before spec 65 re-export from
// here so no import site breaks. Types only — nothing is emitted.

import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

export type UserRole = Enums["user_role"];
export type WorkPackageStatus = Enums["work_package_status"];
export type WorkPackagePriority = Enums["work_package_priority"];
export type ProjectStatus = Enums["project_status"];
export type PhotoPhase = Enums["photo_phase"];
export type ApprovalDecision = Enums["approval_decision"];
export type ReportStatus = Enums["report_status"];
export type PurchaseRequestStatus = Enums["purchase_request_status"];
export type PurchaseRequestPriority = Enums["purchase_request_priority"];
export type ReworkSource = Enums["rework_source"];
export type ClientAccessTier = Enums["client_access_tier"];
// Spec 284 U3 / ADR 0080 — Legal contracts.
export type ContractCounterpartyType = Enums["contract_counterparty_type"];
export type ContractType = Enums["contract_type"];
export type ContractStatus = Enums["contract_status"];
// Spec 284 U4 / ADR 0080 — Legal document approvals.
export type DocumentTargetType = Enums["document_target_type"];
export type DocumentDecision = Enums["document_decision"];
// Spec 314 / ADR 0082 — WHT basis for the level-standard rate. (worker_level's
// type/label/order SSOT already lives in src/lib/nova/dials.ts — reuse that.)
export type WhtBasis = Enums["wht_basis"];
