"use client";

import { useLanguage } from "@/components/language-provider";

export default function EventsPage() {
  const { t } = useLanguage();
  return (
    <main className="max-w-6xl mx-auto py-12 px-6 space-y-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">{t("events.label")}</p>
        <h1 className="text-3xl md:text-4xl font-semibold text-white">{t("events.title")}</h1>
        <p className="text-zinc-300 max-w-2xl">{t("events.subtitle")}</p>
      </header>

      <section className="glass-panel p-6 md:p-8 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-70">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
        </div>

        <div className="relative grid gap-6 md:grid-cols-[1.2fr_0.8fr] items-start">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_0_6px_rgba(56,189,248,0.15)]" />
              {t("events.comingSoon")}
            </div>

            <h2 className="text-xl md:text-2xl font-semibold text-white">{t("events.comingTitle")}</h2>
            <p className="text-sm text-zinc-400 max-w-xl">{t("events.comingBody")}</p>

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="pill">{t("events.pill.weekend")}</span>
              <span className="pill">{t("events.pill.season")}</span>
              <span className="pill">{t("events.pill.mmr")}</span>
              <span className="pill">{t("events.pill.prize")}</span>
            </div>
          </div>

          <div className="glass-panel p-5 space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("events.planned")}</p>
            <ul className="space-y-2 text-sm text-zinc-300">
              <li className="tile">{t("events.item.1")}</li>
              <li className="tile">{t("events.item.2")}</li>
              <li className="tile">{t("events.item.3")}</li>
              <li className="tile">{t("events.item.4")}</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}