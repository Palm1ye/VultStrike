"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AccountCenter } from "@/components/account-center";
import { LeaderboardPanel } from "@/components/leaderboard-panel";
import { useMatchmakingModal } from "@/components/matchmaking-modal-provider";
import { QueueCard } from "@/components/queue-card";
import { StatusStrip, type StatusState, type Stat } from "@/components/status-strip";
import { useLanguage } from "@/components/language-provider";
import { useAppState } from "@/components/app-state-provider";
import { getApiBase } from "@/lib/api-base";
import { readMatchmakingIntent } from "@/lib/matchmaking-intent";

const BANNER_DISMISSED_KEY = "vultstrike_dev_banner_dismissed_v1";

type ControlRoomSnapshot = {
  activeServers: number;
  queuedPlayers: number;
  activeMatches: number;
  avgSpinUpSeconds: number;
  utilization: number;
};

type Cs2CompatibilitySnapshot = {
  installedBuildId: string | null;
  latestBuildId: string | null;
  compatible: boolean | null;
  state: "compatible" | "outdated" | "checking" | "unknown";
  checkedAt: string | null;
  message: string;
};

export default function HomePage() {
  const { t } = useLanguage();
  const { user, session, authenticate, joinQueue, notice, clearNotice, notify, queue, match } = useAppState();
  const { open: openMatchmaking } = useMatchmakingModal();
  const [status, setStatus] = useState<"online" | "offline" | "connecting">("connecting");
  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [controlRoom, setControlRoom] = useState<ControlRoomSnapshot | null>(null);
  const [cs2Compatibility, setCs2Compatibility] = useState<Cs2CompatibilitySnapshot | null>(null);
  const apiBase = getApiBase();

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(BANNER_DISMISSED_KEY)) setBannerDismissed(false);
    } catch { setBannerDismissed(false); }
  }, []);

  useEffect(() => {
    const intent = readMatchmakingIntent();
    if (!intent) return;
    const timeout = window.setTimeout(() => openMatchmaking(), 50);
    return () => window.clearTimeout(timeout);
  }, [openMatchmaking]);

  const dismissBanner = () => {
    setBannerDismissed(true);
    try { window.localStorage.setItem(BANNER_DISMISSED_KEY, "1"); } catch { /* ignore */ }
  };

  // Check if user has an active unfinished match
  const hasActiveMatch = useMemo(() => {
    if (!match?.id) return false;
    // Match is active if it's not FINISHED or CANCELLED
    const finishedStatuses = ['FINISHED', 'CANCELLED', 'ABANDONED'];
    return !finishedStatuses.includes(match.status);
  }, [match]);

  const activeMatchId = match?.id ?? queue?.match?.id ?? null;

  const handlePrimaryCta = async () => {
    if (!session) {
      await authenticate();
    }
    openMatchmaking();
  };

  const handleContinueMatch = () => {
    if (activeMatchId) {
      window.location.href = `/match/${activeMatchId}`;
    }
  };

  // handleSecondaryCta removed - not currently used

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");
    if (authError) {
      notify({ type: "error", message: decodeURIComponent(authError) });
      params.delete("authError");
      const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`.replace(/\?$/, "");
      window.history.replaceState({}, "", next);
    }
  }, [notify]);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const res = await fetch(`${apiBase}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error("Status unavailable");
        const data = (await res.json()) as {
          ok: boolean;
          services?: Record<string, { status?: string }>;
        };
        const matchmakerStatus = data.services?.matchmaker?.status ?? "scanning";
        const next = data.ok && (matchmakerStatus === "deployed" || matchmakerStatus === "optimal") ? "online" : "connecting";
        if (active) setStatus(next);
      } catch {
        if (active) setStatus("offline");
      }
    }

    async function loadQueueStats() {
      try {
        const summary = (await fetch(`${apiBase}/queues/summary`, { cache: "no-store" }).then((r) => r.json())) as {
          "1v1"?: { population?: number; eta?: number };
          "2v2"?: { population?: number; eta?: number };
          "3v3"?: { population?: number; eta?: number };
        };
        if (!active) return;
        setQueueStats({
          "1v1": { population: summary["1v1"]?.population ?? 0, eta: summary["1v1"]?.eta ?? 27 },
          "2v2": { population: summary["2v2"]?.population ?? 0, eta: summary["2v2"]?.eta ?? 43 },
          "3v3": { population: summary["3v3"]?.population ?? 0, eta: summary["3v3"]?.eta ?? 58 }
        });
      } catch {
        if (active) setQueueStats(null);
      }
    }

    async function loadControlRoom() {
      try {
        const next = (await fetch(`${apiBase}/status/control-room`, { cache: "no-store" }).then((r) => r.json())) as ControlRoomSnapshot;
        if (!active) return;
        setControlRoom(next);
      } catch {
        if (active) setControlRoom(null);
      }
    }

    async function loadCs2Compatibility() {
      try {
        const next = (await fetch(`${apiBase}/status/cs2-compatibility`, { cache: "no-store" }).then((r) => r.json())) as Cs2CompatibilitySnapshot;
        if (!active) return;
        setCs2Compatibility(next);
      } catch {
        if (active) setCs2Compatibility(null);
      }
    }

    void loadStatus();
    void loadQueueStats();
    void loadControlRoom();
    void loadCs2Compatibility();
    const interval = window.setInterval(() => {
      void loadStatus();
      void loadQueueStats();
      void loadControlRoom();
      void loadCs2Compatibility();
    }, 20000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [apiBase]);

  // Matchmaking modal is mounted globally (see MatchmakingModalProvider in app/layout).

  const [queueStats, setQueueStats] = useState<Record<string, { population: number; eta: number }> | null>(null);

  const hottestQueue = useMemo(() => {
    if (!queueStats) return null;
    return Object.entries(queueStats)
      .sort((a, b) => (b[1]?.population ?? 0) - (a[1]?.population ?? 0))[0] ?? null;
  }, [queueStats]);

  const recentMatches = useMemo(() => (user?.recentMatches ?? []).slice(0, 3), [user?.recentMatches]);

  const latestMatch = recentMatches[0] ?? null;

  const latestMatchDeltaLabel =
    typeof latestMatch?.mmrDelta === "number"
      ? `${latestMatch.mmrDelta >= 0 ? "+" : ""}${latestMatch.mmrDelta} MMR`
      : t("home.recentTag");

  const handleRunItBack = async () => {
    if (!session) {
      await authenticate();
    }
    openMatchmaking();
  };

  const stats = useMemo<Stat[]>(() => {
    const stateLabel = status === "online" ? t("status.state.online") : status === "offline" ? t("status.state.offline") : t("status.state.connecting");
    const totalPlayers = queueStats
      ? Object.values(queueStats).reduce((sum, q) => sum + (q.population ?? 0), 0)
      : null;
    const playersLabel = totalPlayers !== null ? `${totalPlayers} online` : stateLabel;
    const compatibilityValue =
      cs2Compatibility?.state === "compatible"
        ? t("stats.compatibility.value.compatible")
        : cs2Compatibility?.state === "outdated"
          ? t("stats.compatibility.value.outdated")
          : cs2Compatibility?.state === "checking"
            ? t("stats.compatibility.value.checking")
            : t("stats.compatibility.value.unknown");
    const compatibilityMeta = cs2Compatibility?.installedBuildId && cs2Compatibility?.latestBuildId
      ? `${cs2Compatibility.installedBuildId} / ${cs2Compatibility.latestBuildId}`
      : t("stats.compatibility.meta");
    const compatibilityStatus: StatusState =
      cs2Compatibility?.state === "compatible"
        ? "online"
        : cs2Compatibility?.state === "outdated"
          ? "maintenance"
          : cs2Compatibility?.state === "checking"
            ? "connecting"
            : "offline";
    return [
      { label: t("stats.system.label"), value: stateLabel, meta: t("stats.system.meta"), status: status as StatusState },
      { label: t("stats.matchmaking.label"), value: playersLabel, meta: t("stats.matchmaking.meta"), status: status as StatusState },
      { label: t("stats.compatibility.label"), value: compatibilityValue, meta: compatibilityMeta, status: compatibilityStatus }
    ];
  }, [status, queueStats, cs2Compatibility, t]);

  const queues = useMemo(
    () => [
      {
        id: "1v1",
        mode: t("queues.1v1.title"),
        eta: `${queueStats?.["1v1"]?.eta ?? 27}s`,
        players: queueStats?.["1v1"]?.population ?? 0,
        description: t("queues.1v1.description"),
        skillLabel: t("queues.1v1.skill")
      },
      {
        id: "2v2",
        mode: t("queues.2v2.title"),
        eta: `${queueStats?.["2v2"]?.eta ?? 43}s`,
        players: queueStats?.["2v2"]?.population ?? 0,
        description: t("queues.2v2.description"),
        skillLabel: t("queues.2v2.skill")
      },
      {
        id: "3v3",
        mode: t("queues.3v3.title"),
        eta: `${queueStats?.["3v3"]?.eta ?? 58}s`,
        players: queueStats?.["3v3"]?.population ?? 0,
        description: t("queues.3v3.description"),
        skillLabel: t("queues.3v3.skill")
      }
    ],
    [queueStats, t]
  );

  return (
    <main className="max-w-7xl mx-auto pb-16 px-6 space-y-6">
      {/* Development Warning Banner — dismissible */}
      {!bannerDismissed && (
        <div className="glass-panel px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm border-amber-500/30 bg-amber-500/10">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-amber-100 font-medium">This is an early version of VultStrike.</p>
              <p className="text-amber-200/70 text-xs">Please expect bugs. <span className="italic">Seriously.</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="px-2 py-1 rounded text-xs font-mono bg-amber-500/20 text-amber-300">v0.3.1</span>
            <button
              type="button"
              onClick={dismissBanner}
              className="text-amber-400/60 hover:text-amber-300 transition text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div
          className={`glass-panel px-4 py-3 flex items-center justify-between text-sm border ${
            notice.type === "error"
              ? "border-rose-500/30 text-rose-100"
              : notice.type === "success"
              ? "border-emerald-500/30 text-emerald-100"
              : "border-white/10 text-zinc-200"
          }`}
          role="status"
        >
          <span>{notice.message}</span>
          <button className="text-xs text-zinc-400 hover:text-white" type="button" onClick={clearNotice}>
            Close
          </button>
        </div>
      )}

      <header className="grid lg:grid-cols-[2fr_1fr] gap-8" id="hero">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-white/5 text-xs uppercase tracking-[0.35em] text-brand">
              {t("hero.label")}
            </span>
            <span className="text-xs text-zinc-400">VAC-based protection • Instant servers • Rewards on every win</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight max-w-3xl">{t("hero.headline")}</h1>
          <p className="text-zinc-300 text-lg max-w-3xl">{t("hero.description")}</p>
          <div className="flex flex-wrap gap-3">
            {hasActiveMatch && activeMatchId ? (
              <button
                className="px-6 py-3 rounded-full bg-brand text-black font-semibold shadow-[0_12px_30px_rgba(255,115,29,0.35)]"
                type="button"
                onClick={handleContinueMatch}
              >
                Continue Match
              </button>
            ) : (
              <button
                className="px-6 py-3 rounded-full bg-brand text-black font-semibold shadow-[0_12px_30px_rgba(255,115,29,0.35)]"
                type="button"
                onClick={() => {
                  void handlePrimaryCta();
                }}
              >
                {user ? "Find Match" : t("hero.ctaPrimary")}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <StatusStrip stats={stats} />
          <AccountCenter />
        </div>
      </header>

      <section className="grid lg:grid-cols-[2fr_1fr] gap-6" aria-label="core layout">
        <div className="space-y-8">
          {!hasActiveMatch && (
            <section className="space-y-3" aria-label="queues" id="queues">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Queues</p>
                  <h2 className="text-xl font-semibold text-white">Pick your fight</h2>
                </div>
                <button className="chip" type="button" onClick={openMatchmaking}>
                  Open matchmaking
                </button>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                {queues.map((queue) => (
                  <QueueCard
                    key={queue.mode}
                    {...queue}
                    avgLabel={t("queues.avg")}
                    primaryActionLabel={t("queues.primary")}
                    onlineLabel={t("queues.online")}
                    onPrimaryAction={() => {
                      void joinQueue(queue.id);
                      openMatchmaking();
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {hasActiveMatch && activeMatchId && (
            <section className="space-y-3" aria-label="active-match" id="active-match">
              <div className="glass-panel p-6 space-y-4 border-brand/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-brand">Active Match</p>
                    <h2 className="text-xl font-semibold text-white">You have an unfinished match</h2>
                  </div>
                  <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <p className="text-zinc-400">
                  You are currently in a match that has not finished yet. Please continue your match before searching for a new one.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="px-6 py-3 rounded-full bg-brand text-black font-semibold"
                    type="button"
                    onClick={handleContinueMatch}
                  >
                    Continue Match
                  </button>
                  <Link
                    className="px-6 py-3 rounded-full border border-white/10 text-white hover:border-brand"
                    href={`/match/${activeMatchId}`}
                  >
                    Open Match Dashboard
                  </Link>
                </div>
              </div>
            </section>
          )}
          <section className="grid md:grid-cols-2 gap-6" id="explore">
            <section className="glass-panel p-5 space-y-4" aria-label="live-now">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{t("home.liveNow")}</p>
                  <h3 className="text-lg font-semibold text-white">{t("home.platformPulse")}</h3>
                </div>
                <span className={`h-2.5 w-2.5 rounded-full ${status === 'online' ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]' : status === 'connecting' ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.7)]' : 'bg-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.7)]'}`} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{t("home.platform.matches")}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{controlRoom?.activeMatches ?? '--'}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{t("home.platform.players")}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{controlRoom?.queuedPlayers ?? '--'}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{t("home.platform.servers")}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{controlRoom?.activeServers ?? '--'}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{t("home.platform.spinup")}</p>
                  <p className="mt-2 text-2xl font-semibold text-brand">{controlRoom?.avgSpinUpSeconds ? `${controlRoom.avgSpinUpSeconds}s` : '--'}</p>
                </div>
              </div>
              {hottestQueue ? (
                <div className="rounded-2xl border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-zinc-200">
                  <span className="font-medium text-white">{t("home.hotQueue")}</span> {hottestQueue[0]} · {hottestQueue[1].population} {t("queues.online")} · ~{hottestQueue[1].eta}s
                </div>
              ) : null}
            </section>

            <section className="glass-panel p-5 space-y-4" aria-label="play-again">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{t("home.returnFast")}</p>
                  <h3 className="text-lg font-semibold text-white">{t("home.keepSessionMoving")}</h3>
                </div>
                {latestMatch ? (
                  <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.24em] ${typeof latestMatch.mmrDelta === 'number' && latestMatch.mmrDelta >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-zinc-300'}`}>
                    {latestMatchDeltaLabel}
                  </span>
                ) : null}
              </div>

              {latestMatch ? (
                <Link
                  href={`/match/${latestMatch.id}`}
                  className="block rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:border-brand/40"
                >
                  <p className="font-semibold text-white">{latestMatch.map || t("profile.unknown")}</p>
                  <p className="mt-1 text-xs text-zinc-500">{latestMatch.status} · {latestMatch.completedAt ? new Date(latestMatch.completedAt).toLocaleString() : t("home.recentlyPlayed")}</p>
                </Link>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
                  {t("home.recentMatchesEmpty")}
                </div>
              )}

              <button
                className="w-full rounded-full bg-brand px-5 py-3 font-semibold text-black shadow-[0_12px_30px_rgba(255,115,29,0.24)]"
                type="button"
                onClick={() => { void handleRunItBack(); }}
              >
                {user ? t("home.playAgain") : t("home.signInQueue")}
              </button>
            </section>
          </section>
        </div>

        <div className="space-y-6">
          <LeaderboardPanel />
        </div>
      </section>

      {/* Matchmaking modal is rendered globally by MatchmakingModalProvider */}
    </main>
  );
}
