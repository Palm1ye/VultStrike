"use client";

import { useLanguage } from "./language-provider";
import { useAppState } from "./app-state-provider";

const scoreboard = {
  matchId: "match_9341",
  map: "de_mirage",
  rounds: "9 - 5",
  mmrDelta: 18,
  duration: "16m 44s",
  teams: {
    alpha: [
      { player: "tower", kills: 19, assists: 6, deaths: 9, rating: 1.34, delta: 10 },
      { player: "minty", kills: 15, assists: 8, deaths: 11, rating: 1.12, delta: 8 }
    ],
    bravo: [
      { player: "l1ght", kills: 12, assists: 5, deaths: 14, rating: 0.94, delta: -6 },
      { player: "yokoh", kills: 10, assists: 7, deaths: 15, rating: 0.88, delta: -12 }
    ]
  }
};

export function MatchScoreboard() {
  const { t } = useLanguage();
  const { user } = useAppState();

  const headings = [
    t("scoreboard.kills"),
    t("scoreboard.assists"),
    t("scoreboard.deaths"),
    t("scoreboard.rating"),
    ...(user ? [t("scoreboard.mmrDelta")] : [])
  ];

  const renderRow = (entry: { player: string; steamDisplayName?: string; displayName?: string; kills: number; assists: number; deaths: number; rating: number; delta: number }) => (
    <tr key={entry.player} className="border-b border-white/5">
      <td className="px-4 py-3 font-semibold text-white">{entry.steamDisplayName ?? entry.displayName ?? entry.player}</td>
      <td className="px-4 py-3 text-right">{entry.kills}</td>
      <td className="px-4 py-3 text-right">{entry.assists}</td>
      <td className="px-4 py-3 text-right">{entry.deaths}</td>
      <td className="px-4 py-3 text-right">{entry.rating}</td>
      {user ? (
        <td className={`px-4 py-3 text-right ${entry.delta < 0 ? "text-rose-300" : "text-emerald-300"}`}>
          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
        </td>
      ) : null}
    </tr>
  );

  return (
    <div className="glass-panel p-6 space-y-5" id="scoreboard">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-400">{t("scoreboard.latest")}</p>
          <h3 className="text-2xl font-semibold">Match {scoreboard.matchId}</h3>
        </div>
        <div className="text-right">
          <p className="text-sm text-zinc-400">{scoreboard.map}</p>
          <p className="text-lg font-semibold">{t("scoreboard.final")} {scoreboard.rounds}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-zinc-500">
            <tr>
              <th className="text-left px-4 py-3">{t("scoreboard.teamAlpha")}</th>
              {headings.map((heading) => (
                <th key={heading} className="px-4 py-3 text-right">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{scoreboard.teams.alpha.map((entry) => renderRow(entry))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-zinc-500">
            <tr>
              <th className="text-left px-4 py-3">{t("scoreboard.teamBravo")}</th>
              {headings.map((heading) => (
                <th key={heading} className="px-4 py-3 text-right">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{scoreboard.teams.bravo.map((entry) => renderRow(entry))}</tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{t("scoreboard.duration", { duration: scoreboard.duration })}</span>
        {user ? <span className="text-emerald-300">{t("scoreboard.mmrApplied", { mmr: scoreboard.mmrDelta })}</span> : null}
      </div>
    </div>
  );
}
