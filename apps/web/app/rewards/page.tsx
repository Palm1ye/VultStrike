"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app-state-provider";
import { useLanguage } from "@/components/language-provider";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();
const SESSION_TOKEN_KEY = "vultstrike_session_token";

type Drop = {
  id: number;
  rarity: string;
  item: string;
  source: string;
  createdAt: string | null;
};

type WalletResponse =
  | { ok: true; credits: number; drops: Drop[] }
  | { ok: false; error: string };

type OpenCaseResponse =
  | { ok: true; credits: number; drop: { id: number | null; rarity: string; item: string } }
  | { ok: false; error: string; cost?: number };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem(SESSION_TOKEN_KEY) : null;
  const hasBody = typeof init?.body !== "undefined" && init.body !== null;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default function RewardsPage() {
  const { t } = useLanguage();
  const { session, authenticate } = useAppState();
  const [wallet, setWallet] = useState<{ credits: number; drops: Drop[] } | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);

  const caseCost = 250;

  const loadWallet = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setWalletError(null);
    try {
      const res = await api<WalletResponse>("/rewards/me");
      if (!res.ok) {
        setWallet(null);
        setWalletError(res.error);
        return;
      }
      setWallet({ credits: res.credits, drops: res.drops });
    } catch (err) {
      setWallet(null);
      setWalletError(err instanceof Error ? err.message : "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void loadWallet();
  }, [session, loadWallet]);

  const canOpen = useMemo(() => {
    if (!session) return false;
    if (!wallet) return false;
    return wallet.credits >= caseCost;
  }, [session, wallet]);

  const onOpen = useCallback(async () => {
    if (!session) {
      await authenticate("steam");
      return;
    }
    if (!wallet) return;
    setOpening(true);
    setWalletError(null);
    try {
      const res = await api<OpenCaseResponse>("/rewards/open", {
        method: "POST",
        body: JSON.stringify({ caseType: "standard" })
      });
      if (!res.ok) {
        setWalletError(res.error);
        return;
      }
      setWallet((prev) => {
        const nextDrops = prev?.drops ? [{ id: res.drop.id ?? -1, rarity: res.drop.rarity, item: res.drop.item, source: "CASE_OPEN", createdAt: null }, ...prev.drops] : [];
        return { credits: res.credits, drops: nextDrops };
      });
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Failed to open case");
    } finally {
      setOpening(false);
    }
  }, [authenticate, session, wallet]);

  return (
    <main className="max-w-6xl mx-auto py-12 px-6 space-y-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">{t("rewards.label")}</p>
        <h1 className="text-3xl md:text-4xl font-semibold text-white">{t("rewards.pageTitle")}</h1>
        <p className="text-zinc-300 max-w-2xl">{t("rewards.pageSubtitle")}</p>
      </header>

      <section className="glass-panel p-6 md:p-8 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-70">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
        </div>

        <div className="relative space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">{t("rewards.walletTitle")}</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {loading ? "…" : wallet ? wallet.credits : 0}{" "}
                <span className="text-zinc-400 text-base font-medium">{t("rewards.creditsLabel")}</span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">{t("rewards.caseCost", { cost: caseCost })}</p>
            </div>

            <div className="flex items-center gap-3">
              {!session ? (
                <button
                  className="rounded-full bg-brand text-black text-sm font-semibold px-4 py-2 shadow-[0_12px_30px_rgba(255,115,29,0.25)]"
                  type="button"
                  onClick={() => void authenticate("steam")}
                >
                  {t("rewards.signInRequired")}
                </button>
              ) : (
                <button
                  className="rounded-full bg-brand text-black text-sm font-semibold px-4 py-2 shadow-[0_12px_30px_rgba(255,115,29,0.25)] disabled:opacity-60"
                  type="button"
                  onClick={() => void onOpen()}
                  disabled={!canOpen || opening}
                >
                  {opening ? t("rewards.opening") : t("rewards.openCase")}
                </button>
              )}
            </div>
          </div>

          {walletError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {walletError}
            </div>
          ) : null}

          {session && wallet && wallet.drops.length ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("rewards.recentDrops")}</p>
              <div className="grid gap-2 md:grid-cols-2">
                {wallet.drops.slice(0, 6).map((d) => (
                  <div key={`${d.id}:${d.item}`} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-white">{d.item}</p>
                      <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-400">{d.rarity}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{d.source}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="glass-panel p-6 md:p-8 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-70">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-brand/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-amber-200/10 blur-3xl" />
        </div>

        <div className="relative grid gap-6 md:grid-cols-[1.2fr_0.8fr] items-start">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-brand shadow-[0_0_0_6px_rgba(255,115,29,0.10)]" />
              {t("rewards.comingSoon")}
            </div>

            <h2 className="text-xl md:text-2xl font-semibold text-white">{t("rewards.comingTitle")}</h2>
            <p className="text-sm text-zinc-400 max-w-xl">{t("rewards.comingBody")}</p>

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="pill">{t("rewards.pill.season")}</span>
              <span className="pill">{t("rewards.pill.daily")}</span>
              <span className="pill">{t("rewards.pill.streak")}</span>
              <span className="pill">{t("rewards.pill.cosmetics")}</span>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Link className="btn-ghost" href="/">
                {t("rewards.backHome")}
              </Link>
              <Link className="rounded-full bg-brand text-black text-sm font-semibold px-4 py-2 shadow-[0_12px_30px_rgba(255,115,29,0.25)]" href="/community">
                {t("rewards.followUpdates")}
              </Link>
            </div>
          </div>

          <div className="glass-panel p-5 space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("rewards.planned")}</p>
            <ul className="space-y-2 text-sm text-zinc-300">
              <li className="tile">{t("rewards.item.1")}</li>
              <li className="tile">{t("rewards.item.2")}</li>
              <li className="tile">{t("rewards.item.3")}</li>
              <li className="tile">{t("rewards.item.4")}</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
