import { cn } from "@/lib/utils";

// The two standard inline notices (spec 17): the red error strip and the
// zinc empty-state box that every list page rendered as copy-pasted <p>
// elements. Smaller error variants (the upload tile alert, the download
// button error) keep their local geometry and are not consumers.

export function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">
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
        "rounded-md border border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600",
        className,
      )}
    >
      {children}
    </p>
  );
}
