type QueueCardProps = {
  id?: string;
  mode: string;
  eta: string;
  players: number;
  description: string;
  skillLabel: string;
  avgLabel: string;
  primaryActionLabel: string;
  onlineLabel: string;
  onPrimaryAction?: () => void;
};

const CARD_THEMES: Record<string, { label: string; mapImage: string }> = {
  "1v1": {
    label: "SOLO GRIND",
    mapImage: "/maps/de_dust2.png",
  },
  "2v2": {
    label: "TEAMPLAY",
    mapImage: "/maps/de_inferno.png",
  },
  "3v3": {
    label: "PARTY QUEUE",
    mapImage: "/maps/de_mirage.png",
  },
};

export function QueueCard({
  id,
  mode,
  eta,
  players,
  description,
  skillLabel,
  avgLabel,
  primaryActionLabel,
  onlineLabel,
  onPrimaryAction
}: QueueCardProps) {
  const theme = (id ? CARD_THEMES[id] : undefined) ?? {
    label: skillLabel.toUpperCase(),
    mapImage: "/maps/de_ancient.png",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 min-h-[280px] flex flex-col hover:border-white/20 transition-all duration-300 group cursor-default">
      {/* Map background image */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.04]"
        style={{ backgroundImage: `url(${theme.mapImage})` }}
        aria-hidden="true"
      />

      {/* Gradient: top-down dark for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/75 to-black/50 pointer-events-none" />

      {/* ETA badge — top right, pill style */}
      <div className="absolute top-3.5 right-3.5 z-10 flex flex-col items-center justify-center w-14 h-14 rounded-full bg-emerald-500 shadow-[0_4px_20px_rgba(16,185,129,0.5)]">
        <span className="text-[15px] font-black text-black leading-none tracking-tight">{eta}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-black/70 mt-0.5">{avgLabel}</span>
      </div>

      {/* Content pushed to bottom */}
      <div className="relative z-10 flex flex-col justify-end flex-1 p-5 pt-14 gap-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] font-semibold text-zinc-400">
            {theme.label}
          </p>
          <h3 className="text-[1.35rem] font-bold text-white leading-snug mt-0.5">{mode}</h3>
        </div>

        <p className="text-sm text-zinc-300/90 leading-relaxed">{description}</p>

        <div className="flex items-center gap-1.5 text-xs text-zinc-400 py-0.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          <span className="font-bold text-sm text-white">
            {new Intl.NumberFormat("en-US").format(players)}
          </span>
          <span>{onlineLabel}</span>
        </div>

        <button
          className="w-full rounded-xl bg-black/60 backdrop-blur-md border border-white/15 text-white font-semibold py-2.5 hover:bg-black/40 hover:border-white/30 transition-all duration-150 text-sm mt-0.5"
          type="button"
          onClick={onPrimaryAction}
        >
          {primaryActionLabel}
        </button>
      </div>
    </div>
  );
}
