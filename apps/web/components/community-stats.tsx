"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "./language-provider";
import { getApiBase } from "@/lib/api-base";
import { useAppState } from "./app-state-provider";

const API_BASE = getApiBase();

type CommunityStats = {
  activeMatches: number;
  activePlayers: number;
  queueingPlayers: number;
  connectedPlayers?: number;
};

type HttpError = Error & { status?: number };

async function api<T>(path: string): Promise<T> {
  const token = sessionStorage.getItem("vultstrike_session_token");
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!res.ok) {
    const err: HttpError = new Error(await res.text());
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function CommunityStatsPanel() {
  const { t } = useLanguage();
  const { session } = useAppState();
  const [stats, setStats] = useState<CommunityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await api<CommunityStats>("/community/stats");
      setStats(data);
      setError(null);
    } catch (e) {
      const status = e instanceof Error ? (e as HttpError).status : undefined;
      if (status === 401 || status === 403) {
        setError(t("community.stats.authRequired"));
      } else {
        setError(e instanceof Error ? e.message : "Failed to load stats");
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Avoid polling authenticated-only endpoints when the user is not signed in.
    if (!session) {
      setStats(null);
      setError(t("community.stats.authRequired"));
      setLoading(false);
      return;
    }

    void loadStats();
    const interval = window.setInterval(loadStats, 10000);
    return () => window.clearInterval(interval);
  }, [loadStats, session, t]);

  const items = useMemo(() => {
    return [
      {
        label: t("community.stats.activePlayers"),
        value: stats?.activePlayers ?? 0,
        accent: "text-emerald-300"
      },
      {
        label: t("community.stats.activeMatches"),
        value: stats?.activeMatches ?? 0,
        accent: "text-amber-300"
      },
      {
        label: t("community.stats.queueingPlayers"),
        value: stats?.queueingPlayers ?? 0,
        accent: "text-sky-300"
      }
    ];
  }, [stats, t]);

  return (
    <div className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{t("community.stats.title")}</h3>
        <span className="text-xs text-zinc-500">{t("community.stats.subtitle")}</span>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">{t("community.stats.loading")}</div>
      ) : error ? (
        <div className="text-sm text-rose-300">{error}</div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/5 bg-black/30 px-4 py-4"
            >
              <p className="text-[10px] uppercase tracking-[0.35em] text-zinc-500">
                {item.label}
              </p>
              <p className={`mt-2 text-3xl font-semibold ${item.accent}`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-zinc-500">{t("community.stats.note")}</p>
    </div>
  );
}
