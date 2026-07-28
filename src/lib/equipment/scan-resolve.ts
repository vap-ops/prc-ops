// Spec 370 U2 — scan resolution, pure.
//
// parseScanText: the decoded QR/NFC text → an item uuid. The uuid is the ONLY
// thing consumed — we never navigate to or fetch the scanned URL, so neither
// origin nor route is load-bearing (a route/origin check here would be an
// unreachable guard asserting a hazard that is not there: a mutation proved a
// hostile URL without ?item= already dies at the uuid gate). Accepted forms:
// any URL carrying ?item=<uuid> (prod/staging/legacy stickers all work) and a
// bare uuid (hand-typed). A worker badge or random text is null — the screen
// says "not an equipment sticker".
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
