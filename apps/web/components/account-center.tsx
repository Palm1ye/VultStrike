"use client";

import { useLanguage } from "./language-provider";
import { useAppState } from "./app-state-provider";

const mmrByMode = [
  { mode: "1v1", value: 2288 },
  { mode: "2v2", value: 2412 },
  { mode: "3v3", value: 2190 }
];

export function AccountCenter() {
  const { t } = useLanguage();
  const { user } = useAppState();

  return (
    <section className="glass-panel p-5 space-y-4" id="account">
      <div>
        <p className="text-xs text-zinc-500">{t("account.title")}</p>
        <h3 className="text-lg font-semibold">{user ? t("account.overview") : t("account.subtitle")}</h3>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-white/5 bg-black/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0">{t("account.handle")}</p>
              <div className="h-9 w-9 rounded-full bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center text-xs text-zinc-400 shrink-0">
                {user?.steamAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.steamAvatar} alt="Steam avatar" className="h-full w-full object-cover" />
                ) : (
                  (user?.steamDisplayName ?? user?.displayName ?? user?.handle ?? "Guest")
                    .slice(0, 2)
                    .toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">
                  {user?.steamDisplayName ?? user?.displayName ?? t("account.steamUser")}
                </p>
                <p className="text-[10px] text-zinc-500 truncate">
                  {t("account.steamId")} {user?.steamId ?? "--"}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{t("account.trust")}</p>
              <p className="text-lg font-bold text-emerald-400">{user?.trustScore ?? "--"}</p>
            </div>
          </div>
          {user ? (
            <div className="grid grid-cols-3 gap-2">
              {mmrByMode.map((entry) => (
                <div key={entry.mode} className="rounded-lg bg-white/5 p-2.5 text-center">
                  <p className="text-[10px] text-zinc-500 mb-0.5">{entry.mode}</p>
                  <p className="text-base font-bold text-white">{user?.mmr?.[entry.mode] ?? entry.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-white/5 bg-white/5 p-3 text-xs text-zinc-400">
              {t("account.mmrHidden")}
            </div>
          )}
          <p className="text-[10px] text-zinc-500 truncate">
            {user ? t("account.id", { id: user.id }) : t("account.linkHint")}
          </p>
        </div>
      </div>

    </section>
  );
}
