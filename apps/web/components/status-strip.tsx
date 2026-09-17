export type StatusState = "online" | "offline" | "connecting" | "maintenance";

export type Stat = {
  label: string;
  value: string;
  meta: string;
  status: StatusState;
};

export function StatusStrip({ stats }: { stats: Stat[] }) {
  const statusStyles: Record<StatusState, { dot: string; ring: string }> = {
    online: { dot: "bg-emerald-400", ring: "shadow-[0_0_12px_rgba(52,211,153,0.6)]" },
    offline: { dot: "bg-rose-500", ring: "shadow-[0_0_12px_rgba(244,63,94,0.6)]" },
    connecting: { dot: "bg-amber-400", ring: "shadow-[0_0_12px_rgba(251,191,36,0.6)]" },
    maintenance: { dot: "bg-sky-400", ring: "shadow-[0_0_12px_rgba(56,189,248,0.6)]" }
  };

  return (
    <section className="glass-panel grid grid-cols-3 divide-x divide-white/5">
      {stats.map((stat) => (
        <div key={stat.label} className="px-3 py-3 flex flex-col gap-1.5 text-center">
          <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 leading-none truncate">
            {stat.label}
          </p>
          <div className="flex items-center justify-center gap-1.5">
            <span className={`relative flex h-2 w-2 ${statusStyles[stat.status].ring} shrink-0`}>
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${statusStyles[stat.status].dot}`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${statusStyles[stat.status].dot}`} />
            </span>
            <p className="text-xs font-medium text-white truncate">{stat.value}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
