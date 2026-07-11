// Spec 294: sandbox demo-data seeder.
//
// Applies the pure dataset in src/lib/sandbox/seed-data.ts to the SANDBOX
// Supabase project. Idempotent: safe to re-run nightly — existing rows are
// matched by natural keys (email / code / name / note) and never duplicated.
// Append-only tables (labor_logs, photo_logs) are only ever ADDED to, since
// their block triggers forbid UPDATE/DELETE even for service_role; a full
// clean slate is `supabase db reset --db-url <sandbox>` + re-seed (see the
// sandbox-sync workflow's reset dispatch).
//
// Usage: SANDBOX_URL=... SANDBOX_SERVICE_ROLE_KEY=... pnpm seed:sandbox
//
// Like scripts/import-wp.ts, this is a plain tsx script — it cannot import
// src/lib/db/admin.ts (server-only) and builds its own service-role client.

import { deflateSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import {
  SEED_PERSONAS,
  SEED_PROJECTS,
  SEED_SITE_ISSUES,
  SEED_WORKERS,
  buildDailyPlan,
  buildDeliverables,
  buildLaborPlan,
  buildPhotoPlan,
  buildPurchaseRequests,
  buildWorkPackages,
} from "@/lib/sandbox/seed-data";

// Allowlist, not denylist: this script writes with the service key, so it may
// only ever run against the known sandbox project — never prod, never any
// other real project a mis-set env might point at.
const SANDBOX_REF = "mvozffwvkruzariteosf";

const BUCKETS = [
  "catalog-images",
  "contact-docs",
  "feedback-attachments",
  "photos",
  "po-attachments",
  "pr-attachments",
  "reports",
  "site-issues",
  "subcontract-crew-docs",
];

function fail(msg: string): never {
  console.error(`seed-sandbox: ${msg}`);
  process.exit(1);
}

const url = process.env.SANDBOX_URL;
const serviceKey = process.env.SANDBOX_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("SANDBOX_URL and SANDBOX_SERVICE_ROLE_KEY are required");
if (new URL(url).hostname !== `${SANDBOX_REF}.supabase.co`)
  fail(`refusing to run against ${url} — only the sandbox project ${SANDBOX_REF} is allowed`);

const db = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertOk<T>(step: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) fail(`${step}: ${res.error.message}`);
  return res.data;
}

// Minimal solid-colour PNG (truecolor, no deps) so galleries render real images.
function makePng(width: number, height: number, hex: string): Buffer {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw.writeUInt8(r, row + 1 + x * 3);
      raw.writeUInt8(g, row + 2 + x * 3);
      raw.writeUInt8(b, row + 3 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function ensureBuckets(): Promise<void> {
  const existing = assertOk("list buckets", await db.storage.listBuckets());
  const have = new Set((existing ?? []).map((b) => b.name));
  for (const name of BUCKETS) {
    if (have.has(name)) continue;
    const { error } = await db.storage.createBucket(name, { public: false });
    if (error) fail(`create bucket ${name}: ${error.message}`);
    console.log(`bucket + ${name}`);
  }
}

async function ensureUsers(): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  // Paginate the whole pool — an existing persona missed on page 1 would make
  // createUser fail on duplicate email and abort the nightly seed.
  const allUsers: { id: string; email?: string }[] = [];
  for (let page = 1; ; page++) {
    const listedRes = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (listedRes.error) fail(`list auth users: ${listedRes.error.message}`);
    allUsers.push(...listedRes.data.users);
    if (listedRes.data.users.length < 1000) break;
  }
  for (const persona of SEED_PERSONAS) {
    let user = allUsers.find((u) => u.email === persona.email);
    if (!user) {
      const createdRes = await db.auth.admin.createUser({
        email: persona.email,
        email_confirm: true,
        user_metadata: { full_name: persona.fullName },
      });
      if (createdRes.error) fail(`create auth user ${persona.email}: ${createdRes.error.message}`);
      user = createdRes.data.user;
      console.log(`auth user + ${persona.email}`);
    }
    // The auth trigger auto-creates public.users as 'visitor'; promote + name it.
    assertOk(
      `update users row ${persona.email}`,
      await db
        .from("users")
        .update({ role: persona.role, full_name: persona.fullName })
        .eq("id", user.id),
    );
    byKey.set(persona.key, user.id);
  }
  return byKey;
}

async function ensureProjects(): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();
  for (const p of SEED_PROJECTS) {
    assertOk(
      `upsert project ${p.code}`,
      await db
        .from("projects")
        .upsert({ code: p.code, name: p.name }, { onConflict: "code", ignoreDuplicates: true }),
    );
    const row = assertOk(
      `read project ${p.code}`,
      await db.from("projects").select("id").eq("code", p.code).single(),
    );
    if (!row) fail(`project ${p.code} missing after upsert`);
    byCode.set(p.code, row.id);
  }
  return byCode;
}

async function ensureMembers(
  projects: Map<string, string>,
  users: Map<string, string>,
): Promise<void> {
  const memberKeys = ["sa1", "sa2", "pm", "coordinator", "tech"];
  for (const projectId of projects.values()) {
    for (const key of memberKeys) {
      const userId = users.get(key)!;
      const existing = assertOk(
        "read membership",
        await db
          .from("project_members")
          .select("project_id")
          .eq("project_id", projectId)
          .eq("user_id", userId),
      );
      if ((existing ?? []).length > 0) continue;
      assertOk(
        `add member ${key}`,
        await db.from("project_members").insert({
          project_id: projectId,
          user_id: userId,
          added_by: users.get("admin")!,
        }),
      );
    }
  }
}

// WPs bind to project_categories (the per-project clone of the global
// work_categories taxonomy — ADR 0066), so clone the codes the WP template
// uses into every seeded project first.
async function ensureProjectCategories(
  projects: Map<string, string>,
  users: Map<string, string>,
): Promise<Map<string, string>> {
  const wanted = [...new Set(buildWorkPackages().map((w) => w.categoryCode))].sort();
  const globals = assertOk(
    "read work_categories",
    await db.from("work_categories").select("id, code, name_th").in("code", wanted),
  );
  const globalByCode = new Map((globals ?? []).map((c) => [c.code, c]));
  const ids = new Map<string, string>();
  for (const [projectCode, projectId] of projects) {
    for (const [i, code] of wanted.entries()) {
      const global = globalByCode.get(code);
      if (!global) fail(`unknown work_categories code ${code}`);
      const existing = assertOk(
        `read project_category ${code}`,
        await db
          .from("project_categories")
          .select("id")
          .eq("project_id", projectId)
          .eq("code", code),
      );
      let id = (existing ?? [])[0]?.id;
      if (!id) {
        const inserted = assertOk(
          `insert project_category ${code}`,
          await db
            .from("project_categories")
            .insert({
              project_id: projectId,
              code,
              name: global.name_th,
              sort_order: i,
              work_category_id: global.id,
              created_by: users.get("admin")!,
            })
            .select("id")
            .single(),
        );
        if (!inserted) fail(`insert project_category ${code}: no row returned`);
        id = inserted.id;
        console.log(`project category + ${projectCode}/${code}`);
      }
      ids.set(`${projectCode}:${code}`, id);
    }
  }
  return ids;
}

async function ensureWorkPackages(
  projects: Map<string, string>,
  projectCategories: Map<string, string>,
): Promise<Map<string, string>> {
  const wpIds = new Map<string, string>();
  for (const wp of buildWorkPackages()) {
    const projectId = projects.get(wp.projectCode)!;
    const categoryId = projectCategories.get(`${wp.projectCode}:${wp.categoryCode}`);
    if (!categoryId) fail(`unknown category code ${wp.categoryCode}`);
    const existing = assertOk(
      `read wp ${wp.code}`,
      await db.from("work_packages").select("id").eq("project_id", projectId).eq("code", wp.code),
    );
    let id = (existing ?? [])[0]?.id;
    if (!id) {
      const inserted = assertOk(
        `insert wp ${wp.code}`,
        await db
          .from("work_packages")
          .insert({
            project_id: projectId,
            code: wp.code,
            name: wp.name,
            category_id: categoryId,
            status: wp.status,
            priority: wp.priority,
          })
          .select("id")
          .single(),
      );
      if (!inserted) fail(`insert wp ${wp.code}: no row returned`);
      id = inserted.id;
      console.log(`wp + ${wp.projectCode}/${wp.code}`);
    }
    wpIds.set(`${wp.projectCode}:${wp.code}`, id);
  }
  return wpIds;
}

async function ensureWorkers(users: Map<string, string>): Promise<string[]> {
  const ids: string[] = [];
  for (const w of SEED_WORKERS) {
    const existing = assertOk(
      `read worker ${w.name}`,
      await db.from("workers").select("id").eq("name", w.name),
    );
    let id = (existing ?? [])[0]?.id;
    if (!id) {
      const inserted = assertOk(
        `insert worker ${w.name}`,
        await db
          .from("workers")
          .insert({
            name: w.name,
            day_rate: w.dayRate,
            pay_type: w.payType,
            created_by: users.get("admin")!,
          })
          .select("id")
          .single(),
      );
      if (!inserted) fail(`insert worker ${w.name}: no row returned`);
      id = inserted.id;
      console.log(`worker + ${w.name}`);
    }
    ids.push(id);
  }
  return ids;
}

async function ensureSiteIssues(
  projects: Map<string, string>,
  users: Map<string, string>,
): Promise<void> {
  for (const issue of SEED_SITE_ISSUES) {
    const projectId = projects.get(issue.projectCode)!;
    const existing = assertOk(
      "read site issue",
      await db.from("site_issues").select("id").eq("project_id", projectId).eq("note", issue.note),
    );
    if ((existing ?? []).length > 0) continue;
    assertOk(
      "insert site issue",
      await db.from("site_issues").insert({
        project_id: projectId,
        issue_type: issue.issueType,
        note: issue.note,
        reported_by: users.get("sa1")!,
      }),
    );
    console.log(`site issue + ${issue.issueType} (${issue.projectCode})`);
  }
}

async function ensureLabor(
  wpIds: Map<string, string>,
  workerIds: string[],
  users: Map<string, string>,
): Promise<void> {
  const plan = buildLaborPlan(new Date());
  for (const row of plan) {
    const wpId = wpIds.get(`${row.projectCode}:${row.wpCode}`)!;
    const workerId = workerIds[row.workerIndex];
    const worker = SEED_WORKERS[row.workerIndex];
    if (!workerId || !worker) fail(`labor plan references unknown worker ${row.workerIndex}`);
    const existing = assertOk(
      "read labor log",
      await db
        .from("labor_logs")
        .select("id")
        .eq("work_package_id", wpId)
        .eq("worker_id", workerId)
        .eq("work_date", row.workDate),
    );
    if ((existing ?? []).length > 0) continue;
    assertOk(
      "insert labor log",
      await db.from("labor_logs").insert({
        work_package_id: wpId,
        worker_id: workerId,
        work_date: row.workDate,
        day_fraction: row.dayFraction,
        day_rate_snapshot: worker.dayRate,
        worker_name_snapshot: worker.name,
        pay_type_snapshot: worker.payType,
        entered_by: users.get("sa1")!,
      }),
    );
  }
  console.log(`labor plan ensured (${plan.length} rows)`);
}

async function ensurePhotos(wpIds: Map<string, string>, users: Map<string, string>): Promise<void> {
  for (const photo of buildPhotoPlan()) {
    const wpId = wpIds.get(`${photo.projectCode}:${photo.wpCode}`)!;
    const path = `sandbox/${photo.wpCode}/${photo.phase}.png`;
    const existing = assertOk(
      "read photo log",
      await db
        .from("photo_logs")
        .select("id")
        .eq("work_package_id", wpId)
        .eq("phase", photo.phase)
        .eq("storage_path", path),
    );
    if ((existing ?? []).length > 0) continue;
    const png = makePng(640, 480, photo.colorHex);
    const { error: upErr } = await db.storage
      .from("photos")
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (upErr) fail(`upload ${path}: ${upErr.message}`);
    assertOk(
      "insert photo log",
      await db.from("photo_logs").insert({
        work_package_id: wpId,
        phase: photo.phase,
        storage_path: path,
        uploaded_by: users.get("sa1")!,
      }),
    );
    console.log(`photo + ${path}`);
  }
}

// ——— v1.1 (spec 294 U3): deliverables · purchase requests · daily plans ———

async function ensureDeliverables(
  projects: Map<string, string>,
  wpIds: Map<string, string>,
): Promise<void> {
  const delIds = new Map<string, string>();
  for (const d of buildDeliverables()) {
    const projectId = projects.get(d.projectCode)!;
    const existing = assertOk(
      `read deliverable ${d.code}`,
      await db.from("deliverables").select("id").eq("project_id", projectId).eq("code", d.code),
    );
    let id = (existing ?? [])[0]?.id;
    if (!id) {
      const inserted = assertOk(
        `insert deliverable ${d.code}`,
        await db
          .from("deliverables")
          .insert({ project_id: projectId, code: d.code, name: d.name, sort_order: d.sortOrder })
          .select("id")
          .single(),
      );
      if (!inserted) fail(`insert deliverable ${d.code}: no row returned`);
      id = inserted.id;
      console.log(`deliverable + ${d.projectCode}/${d.code}`);
    }
    delIds.set(`${d.projectCode}:${d.code}`, id);
  }
  // Bind template WPs whose deliverable_id is still NULL (idempotent: never
  // overwrites a binding a tester may have changed).
  for (const wp of buildWorkPackages()) {
    if (!wp.deliverableCode) continue;
    const wpId = wpIds.get(`${wp.projectCode}:${wp.code}`)!;
    const delId = delIds.get(`${wp.projectCode}:${wp.deliverableCode}`)!;
    assertOk(
      `bind wp ${wp.code} deliverable`,
      await db
        .from("work_packages")
        .update({ deliverable_id: delId })
        .eq("id", wpId)
        .is("deliverable_id", null),
    );
  }
  console.log("deliverables ensured + WPs bound");
}

async function ensurePurchaseRequests(
  projects: Map<string, string>,
  wpIds: Map<string, string>,
  users: Map<string, string>,
): Promise<void> {
  for (const pr of buildPurchaseRequests()) {
    const projectId = projects.get(pr.projectCode)!;
    const existing = assertOk(
      "read purchase request",
      await db
        .from("purchase_requests")
        .select("id")
        .eq("project_id", projectId)
        .eq("item_description", pr.itemDescription),
    );
    if ((existing ?? []).length > 0) continue;
    const wpId = pr.wpCode ? wpIds.get(`${pr.projectCode}:${pr.wpCode}`) : undefined;
    if (pr.wpCode && !wpId) fail(`PR ${pr.itemDescription}: unknown WP ${pr.wpCode}`);
    assertOk(
      `insert purchase request ${pr.itemDescription}`,
      await db.from("purchase_requests").insert({
        project_id: projectId,
        item_description: pr.itemDescription,
        quantity: pr.quantity,
        unit: pr.unit,
        status: pr.status,
        requested_by: users.get("sa1")!,
        ...(wpId ? { work_package_id: wpId } : {}),
      }),
    );
    console.log(`purchase request + ${pr.projectCode}/${pr.itemDescription}`);
  }
}

async function ensureDailyPlans(
  projects: Map<string, string>,
  wpIds: Map<string, string>,
  users: Map<string, string>,
): Promise<void> {
  for (const plan of buildDailyPlan(new Date())) {
    const projectId = projects.get(plan.projectCode)!;
    const existing = assertOk(
      "read daily plan",
      await db
        .from("daily_work_plans")
        .select("id")
        .eq("project_id", projectId)
        .eq("plan_date", plan.planDate),
    );
    let planId = (existing ?? [])[0]?.id;
    if (!planId) {
      const inserted = assertOk(
        `insert daily plan ${plan.planDate}`,
        await db
          .from("daily_work_plans")
          .insert({
            project_id: projectId,
            plan_date: plan.planDate,
            created_by: users.get("sa1")!,
          })
          .select("id")
          .single(),
      );
      if (!inserted) fail(`insert daily plan ${plan.planDate}: no row returned`);
      planId = inserted.id;
      console.log(`daily plan + ${plan.projectCode}/${plan.planDate}`);
    }
    for (const code of plan.wpCodes) {
      const wpId = wpIds.get(`${plan.projectCode}:${code}`)!;
      const item = assertOk(
        "read plan item",
        await db
          .from("daily_work_plan_items")
          .select("plan_id")
          .eq("plan_id", planId)
          .eq("work_package_id", wpId),
      );
      if ((item ?? []).length > 0) continue;
      assertOk(
        `insert plan item ${code}`,
        await db.from("daily_work_plan_items").insert({ plan_id: planId, work_package_id: wpId }),
      );
    }
  }
  console.log("daily plans ensured");
}

async function main(): Promise<void> {
  console.log(`seeding sandbox at ${url}`);
  await ensureBuckets();
  const users = await ensureUsers();
  const projects = await ensureProjects();
  await ensureMembers(projects, users);
  const projectCategories = await ensureProjectCategories(projects, users);
  const wpIds = await ensureWorkPackages(projects, projectCategories);
  const workerIds = await ensureWorkers(users);
  await ensureSiteIssues(projects, users);
  await ensureLabor(wpIds, workerIds, users);
  await ensurePhotos(wpIds, users);
  await ensureDeliverables(projects, wpIds);
  await ensurePurchaseRequests(projects, wpIds, users);
  await ensureDailyPlans(projects, wpIds, users);
  console.log("seed complete ✅");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
