"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "./language-provider";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

type CommunityTotals = {
  totalMatches: number;
  totalUsers: number;
};

async function api<T>(path: string): Promise<T> {
  const token = sessionStorage.getItem("vultstrike_session_token");
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export function CommunityTotalsPanel() {
  const { t, lang } = useLanguage();
  const [totals, setTotals] = useState<CommunityTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const formatNumber = useMemo(() => {
    const locale = lang === "tr" ? "tr-TR" : "en-US";
    return new Intl.NumberFormat(locale).format;
  }, [lang]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await api<CommunityTotals>("/community/totals");
        if (!active) return;
        setTotals(data);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load totals");
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    void load();
    const interval = window.setInterval(load, 60_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const items = useMemo(() => {
    return [
      {
        label: t("community.totals.totalUsers"),
        value: formatNumber(totals?.totalUsers ?? 0),
        accent: "text-emerald-300"
      },
      {
        label: t("community.totals.totalMatches"),
        value: formatNumber(totals?.totalMatches ?? 0),
        accent: "text-amber-300"
      }
    ];
  }, [formatNumber, t, totals]);

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{t("community.totals.title")}</h3>
        <span className="text-[10px] uppercase tracking-[0.35em] text-zinc-500">
          {t("community.totals.subtitle")}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">{t("community.totals.loading")}</div>
      ) : error ? (
        <div className="text-sm text-rose-300">{error}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.35em] text-zinc-500">{item.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${item.accent}`}>{item.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
