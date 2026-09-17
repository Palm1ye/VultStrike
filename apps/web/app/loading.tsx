export default function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="glass-panel px-6 py-4 flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full rounded-full bg-brand/60 animate-ping" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-brand" />
        </span>
        <span className="text-sm text-zinc-300">Loading panel…</span>
      </div>
    </div>
  );
}