export function LogoutButton({ label = "ออกจากระบบ" }: { label?: string }) {
  return (
    <form method="post" action="/auth/logout">
      <button
        type="submit"
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-400 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
      >
        {label}
      </button>
    </form>
  );
}
