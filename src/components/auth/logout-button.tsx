export function LogoutButton({ label = "ออกจากระบบ" }: { label?: string }) {
  return (
    <form method="post" action="/auth/logout">
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
      >
        {label}
      </button>
    </form>
  );
}
