// The shape a supplier picker option needs: id + display name + phone. Shared by
// the create-PO sheet, the phone basket, the procurement grid, price comparison,
// the create-PO-from-request button, and the /requests loader. Extracted from the
// (now-removed) purchase-record-form so a pure type has a pure home rather than
// living on a client component (spec 280 dead-code cleanup).
export interface SupplierOption {
  id: string;
  name: string;
  phone: string | null;
}
