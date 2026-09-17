"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useLanguage } from "./language-provider";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

const ITEMS_PER_PAGE = 5;

type LiveMatch = {
  id: string;
  teams: string;
  map: string;
  mode: string;
  score: string;
  state: string;
  latency: string;
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export function MatchFeed() {
  const { t } = useLanguage();
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const loadMatches = useCallback(async () => {
    try {
      const data = await api<LiveMatch[]>("/community/feed");
      setMatches(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load matches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMatches();
    const interval = window.setInterval(loadMatches, 10000);
    return () => window.clearInterval(interval);
  }, [loadMatches]);

  // Pagination logic
  const totalPages = useMemo(() => Math.ceil(matches.length / ITEMS_PER_PAGE), [matches.length]);
  const paginatedMatches = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return matches.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [matches, currentPage]);

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

  return (
    <div className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{t("feed.title")}</h3>
        <span className="text-xs text-emerald-300">{t("feed.subtitle")}</span>
      </div>
      
      {loading ? (
        <div className="text-sm text-zinc-500">Loading matches...</div>
      ) : error ? (
        <div className="text-sm text-rose-300">{error}</div>
      ) : matches.length === 0 ? (
        <div className="text-sm text-zinc-500">No active matches</div>
      ) : (
        <>
          <ul className="space-y-3">
            {paginatedMatches.map((match) => (
              <li key={match.id} className="bg-black/30 border border-white/5 rounded-xl px-4 py-3 space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>{match.id} • {match.mode}</span>
                  <span className="text-amber-300">{match.state}</span>
                </div>
                <p className="text-sm font-semibold text-white">{match.teams}</p>
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>{match.map}</span>
                  <span className="font-mono text-lg text-white">{match.score}</span>
                  <span>{match.latency}</span>
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div className="text-xs text-zinc-500">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, matches.length)} of {matches.length}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 text-zinc-300"
                >
                  Previous
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
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
