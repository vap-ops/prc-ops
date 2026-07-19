// Spec 329 §2 — current set + per-doc history from the append-only rows.
// Anti-join done in memory (PostgREST can't express EXISTS) — the
// current-photos.ts precedent. Both ADR 0015 filters: a head that is a
// tombstone (storage_path NULL) is a retired chain and is dropped whole.
// History walk skips tombstone rows: a revived chain (content superseding a
// tombstone — the mistaken-retire recovery path) shows only content versions.
import type { Tables } from "@/lib/db/database.types";

export type CompanyDocumentRow = Tables<"company_documents">;
export interface CompanyDocument {
  head: CompanyDocumentRow;
  history: CompanyDocumentRow[];
}

export function groupDocuments(rows: CompanyDocumentRow[]): CompanyDocument[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const supersededIds = new Set<string>();
  for (const r of rows) if (r.superseded_by !== null) supersededIds.add(r.superseded_by);
  const docs: CompanyDocument[] = [];
  for (const r of rows) {
    if (supersededIds.has(r.id)) continue;
    if (r.storage_path === null) continue;
    const history: CompanyDocumentRow[] = [];
    let cur = r.superseded_by === null ? undefined : byId.get(r.superseded_by);
    while (cur !== undefined) {
      if (cur.storage_path !== null) history.push(cur);
      cur = cur.superseded_by === null ? undefined : byId.get(cur.superseded_by);
    }
    docs.push({ head: r, history });
  }
  return docs;
}
