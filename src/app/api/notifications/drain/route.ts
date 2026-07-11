// Spec 32 / ADR 0037 — notification outbox drainer.
//
// Invoked every minute by pg_cron → pg_net (invoke_notification_drain())
// with the shared secret from Supabase Vault. Env-gated: answers 503
// until the operator configures the LINE Messaging channel (go-live
// checklist §8) — rows stay `pending` and the 24 h expiry pass protects
// against a backlog flood at first activation.

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { composeNotification, type ComposeContext } from "@/lib/notifications/compose-notification";
import { parseNotificationPayload } from "@/lib/notifications/payload";
import { resolveRecipients } from "@/lib/notifications/resolve-recipients";
import {
  projectPmRecipients,
  SITE_ISSUE_ALERT_ROLE_POOL,
} from "@/lib/notifications/site-issue-recipients";
import { PM_ROLES } from "@/lib/auth/role-home";
import { clientEnv } from "@/lib/env";
import type { UserRole } from "@/lib/db/enums";
import {
  DRAIN_BATCH_SIZE,
  expiryCutoffIso,
  reclaimCutoffIso,
  rowOutcomeAfterPushes,
} from "@/lib/notifications/drain-policy";
import { pushLineMessage } from "@/lib/notifications/line-push";
import { pushTelegramMessage } from "@/lib/notifications/telegram-push";

// First-activation backlog: up to 50 rows × several sequential LINE pushes
// each — needs more than the default function duration.
export const maxDuration = 60;

// Constant-time secret check; hashing both sides normalizes length so
// timingSafeEqual is applicable.
function secretMatches(provided: string | null, expected: string): boolean {
  const a = createHash("sha256")
    .update(provided ?? "")
    .digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = serverEnv.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  const secret = serverEnv.NOTIFICATION_DRAIN_SECRET;
  if (!token || !secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  // Telegram is an OPTIONAL second channel: when set, recipients with a
  // telegram_chat_id also get a Telegram push (in addition to LINE).
  const telegramToken = serverEnv.TELEGRAM_BOT_TOKEN;
  if (!secretMatches(request.headers.get("x-drain-secret"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowMs = Date.now();

  // Reclaim batches a crashed run left in `sending` (claim older than
  // 10 min → back to pending; attempts unchanged — a crash is not a
  // push failure).
  const { error: reclaimError } = await admin
    .from("notification_outbox")
    .update({ status: "pending" })
    .eq("status", "sending")
    .lt("claimed_at", reclaimCutoffIso(nowMs));
  if (reclaimError) {
    console.error("[notifications/drain] reclaim pass failed", reclaimError.message);
    return NextResponse.json({ error: "reclaim_failed" }, { status: 500 });
  }

  const { count: expiredCount, error: expireError } = await admin
    .from("notification_outbox")
    .update({ status: "expired" }, { count: "exact" })
    .eq("status", "pending")
    .lt("created_at", expiryCutoffIso(nowMs));
  if (expireError) {
    console.error("[notifications/drain] expiry pass failed", expireError.message);
    return NextResponse.json({ error: "expiry_failed" }, { status: 500 });
  }

  const expired = expiredCount ?? 0;

  const { data: candidates, error: candidatesError } = await admin
    .from("notification_outbox")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(DRAIN_BATCH_SIZE);
  if (candidatesError) {
    console.error("[notifications/drain] outbox read failed", candidatesError.message);
    return NextResponse.json({ error: "outbox_read_failed" }, { status: 500 });
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ expired, processed: 0, sent: 0, retried: 0, failed: 0 });
  }

  // Claim the batch (`pending` → `sending`) so an overlapping run cannot
  // double-send: the status guard means each row is claimed exactly once;
  // the select returns only the rows THIS run claimed.
  const { data: rows, error: claimError } = await admin
    .from("notification_outbox")
    .update({ status: "sending", claimed_at: new Date(nowMs).toISOString() })
    .in(
      "id",
      candidates.map((c) => c.id),
    )
    .eq("status", "pending")
    .select("id, event_type, work_package_id, purchase_request_id, payload, attempts");
  if (claimError) {
    console.error("[notifications/drain] claim failed", claimError.message);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ expired, processed: 0, sent: 0, retried: 0, failed: 0 });
  }

  // --- Enrichment (batched; one query per concern) -------------------------

  const parsed = rows.map((row) => ({ row, payload: parseNotificationPayload(row.payload) }));

  const wpIds = [
    ...new Set(rows.map((r) => r.work_package_id).filter((id): id is string => id !== null)),
  ];
  const decisionWpIds = [
    ...new Set(
      rows
        .filter((r) => r.event_type === "wp_decision")
        .map((r) => r.work_package_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const needsPmPool = rows.some(
    (r) => r.event_type === "wp_pending_approval" || r.event_type === "pr_created",
  );
  // Spec 201 A4 — feedback_submitted pings the super_admin operator pool.
  const needsSuperPool = rows.some((r) => r.event_type === "feedback_submitted");
  const individualIds = [
    ...new Set(
      parsed.flatMap(({ payload }) =>
        [payload.requestedBy, payload.decidedBy, payload.cancelledBy].filter(
          (id): id is string => id !== undefined,
        ),
      ),
    ),
  ];

  const [wpResult, pmResult, uploaderResult, superResult] = await Promise.all([
    wpIds.length > 0
      ? admin.from("work_packages").select("id, code").in("id", wpIds)
      : Promise.resolve({ data: [], error: null }),
    needsPmPool
      ? admin
          .from("users")
          .select("id, line_user_id, telegram_chat_id")
          // The PM-tier pool = PM_ROLES (incl. project_director, a see-all PM —
          // ADR 0058) so the director receives pending-approval / PR pings too
          // (operator confirmed 2026-06-26). SSOT'd to role-home, not re-listed.
          .in("role", [...PM_ROLES])
      : Promise.resolve({ data: [], error: null }),
    decisionWpIds.length > 0
      ? admin
          .from("photo_logs")
          .select("work_package_id, uploaded_by")
          .in("work_package_id", decisionWpIds)
          // Tombstone rows carry the REMOVER in uploaded_by (ADR 0015) —
          // not an uploader; exclude them from the recipient pool.
          .not("storage_path", "is", null)
      : Promise.resolve({ data: [], error: null }),
    needsSuperPool
      ? admin.from("users").select("id, line_user_id, telegram_chat_id").eq("role", "super_admin")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (wpResult.error || pmResult.error || uploaderResult.error || superResult.error) {
    console.error("[notifications/drain] enrichment failed", {
      wp: wpResult.error?.message,
      pm: pmResult.error?.message,
      uploaders: uploaderResult.error?.message,
      supers: superResult.error?.message,
    });
    return NextResponse.json({ error: "enrichment_failed" }, { status: 500 });
  }

  // PostgREST caps un-ranged responses at 1000 rows; at that size some
  // uploaders would be silently dropped. Pilot volumes sit far below the
  // cap — log loudly if that ever stops being true.
  if ((uploaderResult.data ?? []).length >= 1000) {
    console.warn("[notifications/drain] photo_logs uploader query hit the 1000-row cap");
  }

  const uploaderIdsByWp = new Map<string, string[]>();
  for (const log of uploaderResult.data ?? []) {
    const list = uploaderIdsByWp.get(log.work_package_id) ?? [];
    list.push(log.uploaded_by);
    uploaderIdsByWp.set(log.work_package_id, list);
  }

  const lineIdByUser = new Map<string, string>();
  const telegramChatByUser = new Map<string, string>();
  for (const u of [...(pmResult.data ?? []), ...(superResult.data ?? [])]) {
    if (u.line_user_id) lineIdByUser.set(u.id, u.line_user_id);
    if (u.telegram_chat_id) telegramChatByUser.set(u.id, u.telegram_chat_id);
  }
  const uploaderIds = (uploaderResult.data ?? []).map((l) => l.uploaded_by);
  const remainingIds = [...new Set([...individualIds, ...uploaderIds])].filter(
    (id) => !lineIdByUser.has(id),
  );
  if (remainingIds.length > 0) {
    const { data: extraUsers, error: usersError } = await admin
      .from("users")
      .select("id, line_user_id, telegram_chat_id")
      .in("id", remainingIds);
    if (usersError) {
      console.error("[notifications/drain] user lookup failed", usersError.message);
      return NextResponse.json({ error: "enrichment_failed" }, { status: 500 });
    }
    for (const u of extraUsers ?? []) {
      if (u.line_user_id) lineIdByUser.set(u.id, u.line_user_id);
      if (u.telegram_chat_id) telegramChatByUser.set(u.id, u.telegram_chat_id);
    }
  }

  const wpCodeById = new Map<string, string>();
  for (const wp of wpResult.data ?? []) {
    wpCodeById.set(wp.id, wp.code);
  }
  const pmIds = (pmResult.data ?? []).map((u) => u.id);
  const superIds = (superResult.data ?? []).map((u) => u.id);

  // Spec 211 U8 — a PR notification names its parent ใบสั่งซื้อ when it has one, so
  // the recipient can tell which ORDER the line belongs to (critic gap X1). Resolve
  // purchase_request_id → purchase_order → po_number for every PR-bearing row,
  // batched (2-hop), for composeNotification's poNumber context.
  const prIds = [
    ...new Set(rows.map((r) => r.purchase_request_id).filter((id): id is string => id !== null)),
  ];
  const poNumberByPrId = new Map<string, number>();
  if (prIds.length > 0) {
    const { data: prRows, error: prError } = await admin
      .from("purchase_requests")
      .select("id, purchase_order_id")
      .in("id", prIds);
    if (prError) {
      console.error("[notifications/drain] PR→PO enrichment failed", prError.message);
      return NextResponse.json({ error: "enrichment_failed" }, { status: 500 });
    }
    const poIdByPrId = new Map<string, string>();
    const poIds = new Set<string>();
    for (const pr of prRows ?? []) {
      if (pr.purchase_order_id) {
        poIdByPrId.set(pr.id, pr.purchase_order_id);
        poIds.add(pr.purchase_order_id);
      }
    }
    if (poIds.size > 0) {
      const { data: poRows, error: poError } = await admin
        .from("purchase_orders")
        .select("id, po_number")
        .in("id", [...poIds]);
      if (poError) {
        console.error("[notifications/drain] PO number enrichment failed", poError.message);
        return NextResponse.json({ error: "enrichment_failed" }, { status: 500 });
      }
      const poNumberByPoId = new Map<string, number>();
      for (const po of poRows ?? []) poNumberByPoId.set(po.id, po.po_number);
      for (const [prId, poId] of poIdByPrId) {
        const n = poNumberByPoId.get(poId);
        if (n !== undefined) poNumberByPrId.set(prId, n);
      }
    }
  }

  // --- Site-issue enrichment (spec 277 P1a — serious-issue alert) -----------
  // Recipients = the issue's project PMs (lead + PM-tier members, resolved
  // per-project) + the role-wide project_director / procurement_manager pool.
  // Resolved here so every recipient's contacts are in the maps before the
  // delivery loop. Entirely gated on site_issue_reported rows — no other event
  // type touches any of these queries (the shared drainer stays unchanged).
  const siteIssueRows = parsed.filter(({ row }) => row.event_type === "site_issue_reported");
  const projectPmIdsByProject = new Map<string, string[]>();
  const projectNameById = new Map<string, string>();
  const reporterNameById = new Map<string, string>();
  let siteIssueRolePoolIds: string[] = [];

  if (siteIssueRows.length > 0) {
    const siteIssueProjectIds = [
      ...new Set(
        siteIssueRows
          .map(({ payload }) => payload.projectId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const reporterIds = [
      ...new Set(
        siteIssueRows
          .map(({ payload }) => payload.reportedBy)
          .filter((id): id is string => id !== undefined),
      ),
    ];

    const [projectsRes, membersRes, rolePoolRes] = await Promise.all([
      siteIssueProjectIds.length > 0
        ? admin.from("projects").select("id, name, project_lead_id").in("id", siteIssueProjectIds)
        : Promise.resolve({ data: [], error: null }),
      siteIssueProjectIds.length > 0
        ? admin
            .from("project_members")
            .select("project_id, user_id")
            .in("project_id", siteIssueProjectIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("users")
        .select("id, line_user_id, telegram_chat_id")
        .in("role", [...SITE_ISSUE_ALERT_ROLE_POOL]),
    ]);
    if (projectsRes.error || membersRes.error || rolePoolRes.error) {
      console.error("[notifications/drain] site-issue enrichment failed", {
        projects: projectsRes.error?.message,
        members: membersRes.error?.message,
        rolePool: rolePoolRes.error?.message,
      });
      return NextResponse.json({ error: "enrichment_failed" }, { status: 500 });
    }

    // Role-wide pool — every director + procurement_manager, alerted regardless
    // of project (no per-project PD/proc binding exists).
    for (const u of rolePoolRes.data ?? []) {
      if (u.line_user_id) lineIdByUser.set(u.id, u.line_user_id);
      if (u.telegram_chat_id) telegramChatByUser.set(u.id, u.telegram_chat_id);
    }
    siteIssueRolePoolIds = (rolePoolRes.data ?? []).map((u) => u.id);

    const leadByProject = new Map<string, string>();
    for (const p of projectsRes.data ?? []) {
      if (p.name) projectNameById.set(p.id, p.name);
      if (p.project_lead_id) leadByProject.set(p.id, p.project_lead_id);
    }
    const memberIdsByProject = new Map<string, string[]>();
    for (const m of membersRes.data ?? []) {
      const list = memberIdsByProject.get(m.project_id) ?? [];
      list.push(m.user_id);
      memberIdsByProject.set(m.project_id, list);
    }

    // Candidate users = every project lead + member + reporter. One query yields
    // their role (the PM filter for project PMs), display name (the reporter
    // line), and contacts (LINE / Telegram push targets).
    const candidateIds = [
      ...new Set([
        ...leadByProject.values(),
        ...[...memberIdsByProject.values()].flat(),
        ...reporterIds,
      ]),
    ];
    const roleById = new Map<string, UserRole>();
    if (candidateIds.length > 0) {
      const { data: candidates, error: candidatesError } = await admin
        .from("users")
        .select("id, role, full_name, line_display_name, line_user_id, telegram_chat_id")
        .in("id", candidateIds);
      if (candidatesError) {
        console.error(
          "[notifications/drain] site-issue user lookup failed",
          candidatesError.message,
        );
        return NextResponse.json({ error: "enrichment_failed" }, { status: 500 });
      }
      for (const u of candidates ?? []) {
        roleById.set(u.id, u.role);
        const name = u.full_name ?? u.line_display_name;
        if (name) reporterNameById.set(u.id, name);
        if (u.line_user_id) lineIdByUser.set(u.id, u.line_user_id);
        if (u.telegram_chat_id) telegramChatByUser.set(u.id, u.telegram_chat_id);
      }
    }

    for (const projectId of siteIssueProjectIds) {
      projectPmIdsByProject.set(
        projectId,
        projectPmRecipients({
          leadId: leadByProject.get(projectId) ?? null,
          memberIds: memberIdsByProject.get(projectId) ?? [],
          roleById,
        }),
      );
    }
  }

  // --- Deliver --------------------------------------------------------------

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const { row, payload } of parsed) {
    const recipients = resolveRecipients(row.event_type, payload, {
      pmIds,
      wpUploaderIds: row.work_package_id ? (uploaderIdsByWp.get(row.work_package_id) ?? []) : [],
      superIds,
      siteIssueProjectPmIds: payload.projectId
        ? (projectPmIdsByProject.get(payload.projectId) ?? [])
        : [],
      siteIssueRolePoolIds,
    });
    const lineTargets = recipients
      .map((id) => lineIdByUser.get(id))
      .filter((lineId): lineId is string => lineId !== undefined);
    const telegramTargets = telegramToken
      ? recipients
          .map((id) => telegramChatByUser.get(id))
          .filter((chatId): chatId is string => chatId !== undefined)
      : [];

    const wpCode = row.work_package_id ? wpCodeById.get(row.work_package_id) : undefined;
    const poNumber = row.purchase_request_id
      ? poNumberByPrId.get(row.purchase_request_id)
      : undefined;
    const composeContext: ComposeContext = {
      ...(wpCode !== undefined ? { wpCode } : {}),
      ...(poNumber !== undefined ? { poNumber } : {}),
    };
    // Spec 277 P1a — project name, reporter name, and a deep link into the
    // project, resolved from the site_issue payload's project_id / reported_by.
    if (row.event_type === "site_issue_reported") {
      const projectId = payload.projectId;
      if (projectId !== undefined) {
        const projectName = projectNameById.get(projectId);
        if (projectName !== undefined) composeContext.projectName = projectName;
        composeContext.issueDeepLink = `${clientEnv.NEXT_PUBLIC_APP_URL}/projects/${projectId}`;
      }
      if (payload.reportedBy !== undefined) {
        const reporterName = reporterNameById.get(payload.reportedBy);
        if (reporterName !== undefined) composeContext.issueReporterName = reporterName;
      }
    }
    const text = composeNotification(row.event_type, payload, composeContext);

    let anySuccess = false;
    let lastError: string | null = null;
    for (const to of lineTargets) {
      const result = await pushLineMessage({ token, to, text });
      if (result.ok) {
        anySuccess = true;
      } else {
        lastError = `LINE ${result.status}: ${result.body}`.slice(0, 500);
      }
    }
    // Second channel: Telegram (only recipients with a telegram_chat_id, and only
    // when the bot token is configured). A delivery counts as success if EITHER
    // channel reached the recipient; the row is only retried if every push failed.
    if (telegramToken) {
      for (const chatId of telegramTargets) {
        const result = await pushTelegramMessage({ token: telegramToken, chatId, text });
        if (result.ok) {
          anySuccess = true;
        } else {
          lastError = `Telegram ${result.status}: ${result.body}`.slice(0, 500);
        }
      }
    }

    const outcome = rowOutcomeAfterPushes({
      attempts: row.attempts,
      anySuccess,
      recipientCount: lineTargets.length + telegramTargets.length,
      lastError,
      nowMs,
    });

    const { error: updateError } =
      outcome.status === "sent"
        ? await admin
            .from("notification_outbox")
            .update({ status: "sent", sent_at: outcome.sentAt })
            .eq("id", row.id)
        : await admin
            .from("notification_outbox")
            .update({
              status: outcome.status,
              attempts: outcome.attempts,
              last_error: outcome.lastError,
            })
            .eq("id", row.id);
    if (updateError) {
      console.error("[notifications/drain] outbox row update failed", {
        id: row.id,
        error: updateError.message,
      });
    }

    if (outcome.status === "sent") sent += 1;
    else if (outcome.status === "pending") retried += 1;
    else failed += 1;
  }

  return NextResponse.json({ expired, processed: parsed.length, sent, retried, failed });
}
