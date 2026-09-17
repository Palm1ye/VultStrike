type ExperienceItem = {
  id: string;
  label: string;
  description: string;
};

export function ExperienceMenu({
  items,
  title,
  subtitle,
  hint
}: {
  items: ExperienceItem[];
  title: string;
  subtitle: string;
  hint: string;
}) {
  return (
    <nav className="glass-panel p-5 space-y-4" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-zinc-500">{subtitle}</p>
          <h3 className="text-xl font-semibold">{title}</h3>
        </div>
        <span className="text-xs text-zinc-500 text-right max-w-[200px]">{hint}</span>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 hover:border-brand transition"
          >
            <p className="text-sm font-semibold text-white">{item.label}</p>
            <p className="text-xs text-zinc-400">{item.description}</p>
          </a>
        ))}
      </div>
    </nav>
  );
}
