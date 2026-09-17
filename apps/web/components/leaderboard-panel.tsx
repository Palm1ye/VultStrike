"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useLanguage } from "./language-provider";
import { useAppState } from "./app-state-provider";
import { RANK_TIERS } from "@/lib/ranks";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

const ITEMS_PER_PAGE = 10;

type LeaderboardEntry = {
  player: string;
  displayName?: string;
  steamDisplayName?: string;
  handle?: string;
  tier: string;
  mmr: number;
  streak: number;
  kdr: number;
  trend: string;
};

function getRankColor(tier: string): string {
  const rank = RANK_TIERS.find(r => r.label === tier);
  return rank?.color ?? "text-zinc-400";
}

function getRankGlow(tier: string): { glow: string; intensity: number } {
  const rank = RANK_TIERS.find(r => r.label === tier);
  return { 
    glow: rank?.glow ?? "none", 
    intensity: rank?.intensity ?? 0 
  };
}

// Get special styling for top 3 ranks
function getTopRankStyle(index: number): { 
  bg: string; 
  border: string; 
  text: string; 
  icon: string;
  glow?: string;
} {
  switch (index) {
    case 0: // 1st place - Gold
      return {
        bg: "bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-amber-500/20",
        border: "border-amber-400/50",
        text: "text-amber-300",
        icon: "👑",
        glow: "shadow-[0_0_30px_rgba(251,191,36,0.3)]",
      };
    case 1: // 2nd place - Silver
      return {
        bg: "bg-gradient-to-r from-slate-400/20 via-zinc-400/10 to-slate-400/20",
        border: "border-slate-300/50",
        text: "text-slate-300",
        icon: "🥈",
        glow: "shadow-[0_0_25px_rgba(203,213,225,0.25)]",
      };
    case 2: // 3rd place - Bronze
      return {
        bg: "bg-gradient-to-r from-orange-600/20 via-amber-700/10 to-orange-600/20",
        border: "border-orange-400/50",
        text: "text-orange-300",
        icon: "🥉",
        glow: "shadow-[0_0_20px_rgba(251,146,60,0.2)]",
      };
    default:
      return {
        bg: "bg-black/30",
        border: "border-white/5",
        text: "text-zinc-400",
        icon: "",
      };
  }
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export function LeaderboardPanel() {
  const { t } = useLanguage();
  const { user } = useAppState();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeMode, setActiveMode] = useState<"1v1" | "2v2" | "3v3">("1v1");

  const modes = [
    { id: "1v1", label: "1v1" },
    { id: "2v2", label: "2v2" },
    { id: "3v3", label: "3v3" }
  ] as const;

  const loadLeaderboard = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api<LeaderboardEntry[]>(`/community/leaderboard?mode=${activeMode}&limit=50`);
      setLeaderboard(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, [activeMode]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  // Pagination logic
  const totalPages = useMemo(() => Math.ceil(leaderboard.length / ITEMS_PER_PAGE), [leaderboard.length]);
  const paginatedLeaderboard = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return leaderboard.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [leaderboard, currentPage]);

  // Reset to first page if current page is out of bounds
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Generate page numbers for display
  const pageNumbers = useMemo(() => {
    const pages: (number | string)[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - 1 && i <= currentPage + 1)
      ) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== "...") {
        pages.push("...");
      }
    }
    return pages;
  }, [currentPage, totalPages]);

  // Calculate global rank for display
  const getGlobalRank = (index: number) => (currentPage - 1) * ITEMS_PER_PAGE + index + 1;

  return (
    <div className="glass-panel p-5 space-y-4" id="leaderboard">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">{t("leaderboard.subtitle")}</p>
          <h3 className="text-lg font-semibold">{t("leaderboard.title")}</h3>
        </div>
        <span className="text-[10px] text-zinc-500 shrink-0">{t("leaderboard.note")}</span>
      </div>

      <div className="inline-flex items-center gap-1 rounded-full bg-white/5 p-1">
        {modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => {
              setActiveMode(mode.id);
              setCurrentPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              activeMode === mode.id ? "bg-brand text-black" : "text-zinc-400 hover:text-white"
            }`}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">{t("leaderboard.loading")}</div>
      ) : error ? (
        <div className="text-sm text-rose-300">{error}</div>
      ) : leaderboard.length === 0 ? (
        <div className="text-sm text-zinc-500">{t("leaderboard.empty")}</div>
      ) : (
        <>
          <ul className="space-y-3">
            {paginatedLeaderboard.map((entry, index) => {
              const globalRank = getGlobalRank(index);
              const topStyle = getTopRankStyle(globalRank - 1);
              const rankInfo = getRankGlow(entry.tier);
              const hasGlow = rankInfo.glow !== "none";
              const isTop3 = globalRank <= 3;

              return (
                <li key={entry.handle ?? entry.player}>
                  <Link
                    href={`/profile/${entry.handle ?? entry.player}`}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 border transition-all duration-300 cursor-pointer ${
                      isTop3 
                        ? `${topStyle.bg} ${topStyle.border} ${topStyle.glow || ""}` 
                        : "bg-black/30 border-white/5 hover:border-white/10 hover:border-brand/30"
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Rank Number */}
                    <div className={`flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm ${
                      isTop3 
                        ? `${topStyle.bg} ${topStyle.text} border ${topStyle.border}` 
                        : "text-zinc-500 font-mono"
                    }`}>
                      {isTop3 ? topStyle.icon : `#${globalRank}`}
                    </div>

                    {/* Player Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className={`font-semibold truncate max-w-[180px] sm:max-w-[220px] lg:max-w-[260px] ${isTop3 ? "text-white" : ""}`}>
                          {entry.steamDisplayName ?? entry.displayName ?? entry.handle ?? entry.player}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className={`text-xs font-medium ${getRankColor(entry.tier)}`}>{entry.tier}</p>
                        {hasGlow && !isTop3 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      {user ? (
                        <div className="flex items-center gap-2">
                          <p className={`font-bold text-lg ${isTop3 ? topStyle.text : "text-white"}`}>
                            {entry.mmr}
                          </p>
                          <span className="text-xs text-zinc-500">MMR</span>
                        </div>
                      ) : (
                        <p className="font-semibold text-zinc-500">{t("leaderboard.mmrHidden")}</p>
                      )}
                      <p className="text-xs text-emerald-400">
                        {t("leaderboard.streak", { count: entry.streak })} • {t("leaderboard.kd", { value: entry.kdr })}
                      </p>
                    </div>

                    {/* Trend Badge */}
                    {user ? (
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        entry.trend.startsWith("+") 
                          ? "text-emerald-300 bg-emerald-500/10" 
                          : entry.trend.startsWith("-")
                          ? "text-rose-300 bg-rose-500/10"
                          : "text-zinc-300 bg-white/5"
                      }`}>
                        {entry.trend}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500 bg-white/5 px-2 py-1 rounded-full">{t("leaderboard.signIn")}</span>
                    )}
                  </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div className="text-xs text-zinc-500">
                {t("leaderboard.showing", {
                  start: (currentPage - 1) * ITEMS_PER_PAGE + 1,
                  end: Math.min(currentPage * ITEMS_PER_PAGE, leaderboard.length),
                  total: leaderboard.length
                })}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 text-zinc-300"
                >
                  {t("leaderboard.prev")}
                </button>
                
                <div className="flex items-center gap-1">
                  {pageNumbers.map((page, index) => (
                    page === "..." ? (
                      <span key={`ellipsis-${index}`} className="px-2 text-zinc-500">...</span>
                    ) : (
                      <button
                        key={page}
                        onClick={() => goToPage(page as number)}
                        className={`min-w-[32px] px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          currentPage === page
                            ? "bg-brand text-black"
                            : "text-zinc-300 hover:bg-white/10"
                        }`}
                      >
                        {page}
                      </button>
                    )
                  ))}
                </div>

                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 text-zinc-300"
                >
                  {t("leaderboard.next")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-xs text-zinc-500">{t("leaderboard.footer")}</p>
    </div>
  );
}
