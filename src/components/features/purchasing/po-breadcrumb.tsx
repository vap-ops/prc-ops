import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PoNumberTag } from "@/components/features/purchasing/po-number-tag";

// Spec 211 U6b — the PO-detail breadcrumb. The operator's "can't tell the PO
// from its items" pain is partly a LEVEL problem: a PO detail dropped you onto a
// supplier name with only a bare number chip for context. This crumb names the
// level explicitly — you are in the จัดซื้อ area, viewing one ใบสั่งซื้อ (the
// typed PO chip from U2). The area crumb links back to the worklist (/requests,
// the จัดซื้อ landmark from U6); the order crumb is terminal (the current page,
// never a link). Server-safe (no 'use client') so it drops into the server PO
// page's DetailHeader.
export function PoBreadcrumb({ poNumber }: { poNumber: number | null }) {
  return (
    <nav aria-label="breadcrumb" className="text-ink-secondary flex items-center gap-1 text-xs">
      <Link href="/requests" className="hover:text-ink focus:outline-none focus-visible:underline">
        จัดซื้อ
      </Link>
      <ChevronRight aria-hidden className="text-ink-muted size-3 shrink-0" />
      <span aria-current="page" className="flex items-center gap-1">
        ใบสั่งซื้อ
        <PoNumberTag poNumber={poNumber} />
      </span>
    </nav>
  );
}
