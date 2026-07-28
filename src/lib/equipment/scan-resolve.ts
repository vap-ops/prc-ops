// Spec 370 U2 — scan resolution, pure.
//
// parseScanText: the decoded QR/NFC text → an item uuid. Accepts exactly the
// forms OUR stickers carry — the deep-link URL (any origin, so staging and
// prod stickers both work; the ROUTE, not the origin, is the contract) and a
// bare uuid (hand-typed via the search fallback or a legacy sticker). Anything
// else (a worker badge, a random URL) is null — the scan screen says "not an
// equipment sticker" instead of navigating anywhere (observed content is data,
// never instructions).
//
// resolveScanState: item + open loans → which sheet opens. Bulk gets its OWN
// state (D5: the refusal must explain itself, not silently nothing).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseScanText(text: string): string | null {
  const t = text.trim();
  const bare = t.toLowerCase();
  if (UUID_RE.test(bare)) return bare;
  try {
    const url = new URL(t);
    if (!url.pathname.endsWith("/equipment/scan")) return null;
    const item = url.searchParams.get("item")?.toLowerCase() ?? "";
    return UUID_RE.test(item) ? item : null;
  } catch {
    return null;
  }
}

export interface ScanItem {
  id: string;
  name: string;
  serialNo: string | null;
  assetTag: string | null;
  tracking: "unit" | "bulk";
}

export interface ScanOpenLoan {
  logId: string;
  itemId: string;
  wpId: string;
  wpCode: string;
  wpName: string;
  checkedOutOn: string;
  holderName: string;
}

export type ScanState =
  | { kind: "not_found" }
  | { kind: "bulk"; item: ScanItem }
  | { kind: "in_store"; item: ScanItem }
  | { kind: "out"; item: ScanItem; loan: ScanOpenLoan };

export function resolveScanState(
  itemId: string,
  items: readonly ScanItem[],
  openLoans: readonly ScanOpenLoan[],
): ScanState {
  const item = items.find((i) => i.id === itemId);
  if (!item) return { kind: "not_found" };
  if (item.tracking === "bulk") return { kind: "bulk", item };
  const loan = openLoans.find((l) => l.itemId === itemId);
  return loan ? { kind: "out", item, loan } : { kind: "in_store", item };
}

/** Search over name / serial / asset tag — D3's backup door. */
export function searchScanItems(items: readonly ScanItem[], q: string): ScanItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter(
    (i) =>
      i.name.toLowerCase().includes(needle) ||
      (i.serialNo ?? "").toLowerCase().includes(needle) ||
      (i.assetTag ?? "").toLowerCase().includes(needle),
  );
}
