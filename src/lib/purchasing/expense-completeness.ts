// Spec 285 U2 — a site expense (ซื้อเอง, source='site_purchase') is only
// "complete" once it carries BOTH kinds of evidence: an item photo (a `reference`
// attachment, addReferenceAttachment) AND an accounting doc (an `invoice`
// attachment, addInvoiceAttachment). Attachments FK the parent row so they are
// architecturally post-create; Phase 1 derives completeness from their presence
// at the form/completion layer (no schema — the DB hard-gate is Phase 2).

export function isExpenseComplete(a: {
  hasItemPhoto: boolean;
  hasAccountingDoc: boolean;
}): boolean {
  return a.hasItemPhoto && a.hasAccountingDoc;
}
