"use client";

import Link from "next/link";
import { useLanguage } from "@/components/language-provider";

export default function WhitepaperPage() {
  const { t } = useLanguage();
  const pillars = [1, 2, 3].map((index) => ({
    title: t(`whitepaper.pillar.${index}.title`),
    body: t(`whitepaper.pillar.${index}.body`)
  }));
  const stages = [1, 2, 3].map((index) => ({
    kicker: t(`whitepaper.stage.${index}.kicker`),
    title: t(`whitepaper.stage.${index}.title`),
    body: t(`whitepaper.stage.${index}.body`)
  }));
  const roadmapItems = [1, 2, 3].map((index) => ({
    phase: t(`whitepaper.roadmap.${index}.phase`),
    title: t(`whitepaper.roadmap.${index}.title`),
    body: t(`whitepaper.roadmap.${index}.body`),
    metric: t(`whitepaper.roadmap.${index}.metric`)
  }));
  const growthItems = [1, 2, 3].map((index) => ({
    title: t(`whitepaper.growth.${index}.title`),
    body: t(`whitepaper.growth.${index}.body`),
    metric: t(`whitepaper.growth.${index}.metric`)
  }));

  return (
    <main className="max-w-6xl mx-auto px-6 pb-20 pt-8 space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/30 px-6 py-8 md:px-10 md:py-12">
        <div className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_top_left,rgba(255,115,29,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_30%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
          <div className="space-y-5">
            <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-zinc-400">
              {t("whitepaper.badge")}
            </span>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">{t("whitepaper.title")}</h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-300 md:text-lg">
                {t("whitepaper.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className="rounded-full bg-brand px-5 py-3 font-semibold text-black shadow-[0_12px_30px_rgba(255,115,29,0.28)]">
                {t("whitepaper.backHome")}
              </Link>
              <Link href="/operations" className="rounded-full border border-white/10 px-5 py-3 text-white hover:border-brand transition">
                {t("whitepaper.viewOperations")}
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur-sm">
                <p className="text-sm font-semibold text-white">{pillar.title}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{pillar.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-panel p-6 md:p-7">
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">{t("whitepaper.thesisTitle")}</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">{t("whitepaper.title")}</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-300">{t("whitepaper.thesisBody")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {pillars.map((pillar) => (
            <div key={pillar.title} className="glass-panel p-5">
              <p className="text-sm font-semibold text-white">{pillar.title}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{pillar.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="stages" className="glass-panel p-6 md:p-7 scroll-mt-24">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{t("whitepaper.stageLabel")}</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{t("whitepaper.stageTitle")}</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-zinc-400">{t("whitepaper.stageSubtitle")}</p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {stages.map((stage, index) => (
            <div key={stage.title} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-5">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent" />
              <div className="absolute right-4 top-4 text-4xl font-black text-white/5">0{index + 1}</div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-brand">{stage.kicker}</p>
              <h3 className="mt-3 text-lg font-semibold text-white">{stage.title}</h3>
              <p className="mt-3 text-sm leading-7 text-zinc-300">{stage.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="roadmap-strategy" className="glass-panel p-6 md:p-7 scroll-mt-24">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{t("whitepaper.roadmapLabel")}</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{t("whitepaper.roadmapTitle")}</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-zinc-400">{t("whitepaper.roadmapSubtitle")}</p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {roadmapItems.map((item, index) => (
            <div key={item.phase} className="rounded-2xl border border-white/10 bg-black/25 p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-brand">
                  {item.phase}
                </span>
                <span className="text-xs font-medium text-zinc-500">0{index + 1}</span>
              </div>
              <h3 className="text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-300">
                {item.metric}
              </p>
              <p className="mt-3 text-sm leading-7 text-zinc-300">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="growth-strategy" className="glass-panel p-6 md:p-7 scroll-mt-24">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{t("whitepaper.growthLabel")}</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{t("whitepaper.growthTitle")}</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-zinc-400">{t("whitepaper.growthSubtitle")}</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {growthItems.map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/10 bg-black/25 p-5">
              <h3 className="text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-300">
                {item.metric}
              </p>
              <p className="mt-3 text-sm leading-7 text-zinc-300">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
