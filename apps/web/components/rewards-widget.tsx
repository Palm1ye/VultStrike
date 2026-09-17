"use client";

import { useLanguage } from "./language-provider";

const rewards = [
  { label: "Daily contract", reward: "+250 XP", status: "completed", progress: 100 },
  { label: "Win 3 matches", reward: "+1 Loot Key", status: "progress", progress: 66 },
  { label: "Report confirmations", reward: "+50 Credits", status: "ready", progress: 0 }
];

export function RewardsWidget() {
  const { t } = useLanguage();
  const scrollToStore = () => {
    const el = document.getElementById("store");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="glass-panel p-6 space-y-5" id="rewards">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{t("rewards.title")}</h3>
        <button className="text-xs text-brand" type="button" onClick={scrollToStore}>
          {t("rewards.cta")} →
        </button>
      </div>
      <div className="space-y-4">
        {rewards.map((reward) => (
          <div key={reward.label} className="bg-black/30 rounded-xl px-4 py-3 border border-white/5 space-y-2">
            <div className="flex items-center justify-between text-sm text-zinc-400">
              <p>{reward.label}</p>
              <span className="text-xs text-emerald-300">{t(`rewards.status.${reward.status}`)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{reward.reward}</span>
              <span className="text-xs text-zinc-500">{reward.progress}%</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-amber-400"
                style={{ width: `${reward.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        className="w-full rounded-lg border border-white/10 py-2 text-sm text-zinc-300 hover:border-brand"
        type="button"
        onClick={scrollToStore}
      >
        {t("rewards.pass")}
      </button>
    </div>
  );
}
