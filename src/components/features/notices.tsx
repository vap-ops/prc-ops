import { cn } from "@/lib/utils";

// The two standard inline notices (spec 17): the red error strip and the
// zinc empty-state box that every list page rendered as copy-pasted <p>
// elements. Smaller error variants (the upload tile alert, the download
// button error) keep their local geometry and are not consumers.

export function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control border-danger bg-danger-soft text-danger-ink border px-4 py-3 text-sm font-medium">
      {children}
    </p>
  );
}

export function EmptyNotice({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-control border-edge bg-card text-ink-secondary border px-4 py-6 text-center text-sm shadow-xs",
        className,
      )}
    >
      {children}
    </p>
  );
}
