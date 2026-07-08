// The shape a supplier picker option needs: id + display name + phone. Shared by
// the create-PO sheet, the phone basket, the procurement grid, price comparison,
// the create-PO-from-request button, and the /requests loader. Extracted from the
// (now-removed) purchase-record-form so a pure type has a pure home rather than
// living on a client component (spec 280 dead-code cleanup).
export interface SupplierOption {
  id: string;
  name: string;
  phone: string | null;
  // Spec 280: the supplier's VAT-registration flag, when known — lets the create-PO
  // sheet soft-warn on a non-VAT supplier + VAT rate. Optional: pickers that don't
  // load it (or freshly inline-created suppliers) leave it undefined = no warning.
  isVatRegistered?: boolean | null;
}
