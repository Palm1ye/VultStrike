"use client";

import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "@/lib/api-base";
import { buildConsoleConnectCommand } from "@/lib/steam-connect";
import { Cs2JoinModal } from "./cs2-join-modal";
import { saveMatchmakingIntent } from "@/lib/matchmaking-intent";

const API_BASE = getApiBase();

type PlayerEntry = {
  player: string;
  mmr: number;
  level: number;
  connected: boolean;
  connectedAt?: string | null;
  kills?: number;
  deaths?: number;
  assists?: number;
};

type ServerStatus = 'PENDING' | 'PULLING_IMAGE' | 'STARTING' | 'READY' | 'FAILED';

type MatchDetails = {
  id: string;
  lobbyCode: string;
  map: string;
  mode: string;
  status: string;
  serverStatus: ServerStatus;
  serverError?: string | null;
  serverEndpoint: string | null;
  connect?: string | null;
  liveAt?: string | null;
  joinDeadlineAt?: string | null;
  cancelReason?: string | null;
  winner?: string | null;
  score?: {
    alpha: number;
    bravo: number;
    currentRound: number;
  };
  durationSeconds?: number;
  teams: {
    alpha: PlayerEntry[];
    bravo: PlayerEntry[];
  };
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function MapCard({ map }: { map: string }) {
  // Later: real map thumbs (public/maps/<map>.jpg)
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 via-black to-zinc-900">
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(ellipse_at_top,rgba(255,214,0,0.25),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.08),transparent_60%)]" />
      <div className="relative p-6 md:p-10">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-400">Map</p>
        <h1 className="mt-3 text-3xl md:text-5xl font-semibold">{map}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Server will boot this map as soon as it finishes preparing.
        </p>
      </div>
    </div>
  );
}

function TeamList({ title, players, teamColor }: { title: string; players: PlayerEntry[]; teamColor: 'alpha' | 'bravo' }) {
  const colorClass = teamColor === 'alpha' ? 'text-sky-400' : 'text-amber-400';
  const borderClass = teamColor === 'alpha' ? 'border-sky-500/30' : 'border-amber-500/30';
  
  return (
    <div className={`rounded-3xl border ${borderClass} bg-white/5 p-5`}>
      <p className={`text-xs uppercase tracking-[0.3em] ${colorClass}`}>{title}</p>
      <div className="mt-4 space-y-3">
        {players.length ? (
          players.map((p) => (
            <div key={p.player} className="flex items-center justify-between rounded-2xl bg-black/30 px-4 py-3">
              <div className="flex-1">
                <p className="font-semibold">{p.player}</p>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span>MMR: {p.mmr}</span>
                  <span>Lvl: {p.level}</span>
                  {(p.kills !== undefined || p.deaths !== undefined || p.assists !== undefined) && (
                    <span className="text-zinc-300">
                      K/D/A: {p.kills ?? 0}/{p.deaths ?? 0}/{p.assists ?? 0}
                    </span>
                  )}
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${p.connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-zinc-300'}`}>
                {p.connected ? 'Connected' : 'Pending'}
              </span>
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-black/30 px-4 py-4 text-sm text-zinc-400">Waiting for roster…</div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="h-5 w-5 rounded-full border-2 border-white/20 border-t-brand animate-spin" aria-label="Loading" />
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function MatchTimer({ liveAt, durationSeconds }: { liveAt?: string | null; durationSeconds?: number }) {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    if (durationSeconds !== undefined) {
      setElapsed(durationSeconds);
      return;
    }
    
    if (!liveAt) {
      setElapsed(0);
      return;
    }
    
    const startTime = new Date(liveAt).getTime();
    
    const updateElapsed = () => {
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      setElapsed(Math.max(0, diff));
    };
    
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [liveAt, durationSeconds]);
  
  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Match Time</p>
      <p className="mt-1 text-2xl font-mono font-bold text-white">{formatDuration(elapsed)}</p>
    </div>
  );
}

function ScoreDisplay({ score, status, winner }: { score?: { alpha: number; bravo: number; currentRound: number }; status?: string; winner?: string | null }) {
  const isFinished = status === 'FINISHED';
  
  if (!score) {
    return (
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Score</p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <span className="text-3xl font-bold text-sky-400">-</span>
          <span className="text-xl text-zinc-500">:</span>
          <span className="text-3xl font-bold text-amber-400">-</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">Waiting for match start</p>
      </div>
    );
  }
  
  const getWinnerStyles = (team: 'alpha' | 'bravo') => {
    if (!isFinished || !winner) return {};
    const isWinner = (team === 'alpha' && winner === 'ALPHA') || (team === 'bravo' && winner === 'BRAVO');
    const isLoser = (team === 'alpha' && winner === 'BRAVO') || (team === 'bravo' && winner === 'ALPHA');
    
    if (isWinner) return { className: 'text-emerald-400', label: 'WINNER' };
    if (isLoser) return { className: 'text-rose-400', label: '' };
    return {};
  };
  
  const alphaStyles = getWinnerStyles('alpha');
  const bravoStyles = getWinnerStyles('bravo');
  
  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{isFinished ? 'Final Score' : 'Score'}</p>
      <div className="mt-2 flex items-center justify-center gap-4">
        <div className="flex flex-col items-center">
          <span className={`text-4xl font-bold ${alphaStyles.className || 'text-sky-400'}`}>{score.alpha}</span>
          {alphaStyles.label && <span className="text-[10px] text-emerald-400 font-semibold mt-1">{alphaStyles.label}</span>}
        </div>
        <span className="text-2xl text-zinc-500">:</span>
        <div className="flex flex-col items-center">
          <span className={`text-4xl font-bold ${bravoStyles.className || 'text-amber-400'}`}>{score.bravo}</span>
          {bravoStyles.label && <span className="text-[10px] text-emerald-400 font-semibold mt-1">{bravoStyles.label}</span>}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {isFinished ? `Match Finished • ${score.currentRound} Rounds Played` : `Round ${score.currentRound}`}
      </p>
    </div>
  );
}

const serverStatusSteps: { status: ServerStatus; label: string }[] = [
  { status: 'PENDING', label: 'Queued' },
  { status: 'PULLING_IMAGE', label: 'Pulling Image' },
  { status: 'STARTING', label: 'Starting Server' },
  { status: 'READY', label: 'Ready' },
];

const reportReasons = [
  { value: "CHEATING", label: "Cheating / Hacks" },
  { value: "ABUSE", label: "Toxic / Abuse" },
  { value: "GRIEFING", label: "Griefing" },
  { value: "AFK", label: "AFK / Leaver" },
  { value: "BUG", label: "Bug / Exploit" },
  { value: "OTHER", label: "Other" }
];

function ServerProgress({ serverStatus, serverError }: { serverStatus: ServerStatus; serverError?: string | null }) {
  const currentIndex = serverStatusSteps.findIndex(s => s.status === serverStatus);
  const isFailed = serverStatus === 'FAILED';
  
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-zinc-400 mb-4">Server Status</p>
      
      {isFailed ? (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4">
          <div className="flex items-center gap-2 text-rose-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium">Server Failed</span>
          </div>
          {serverError && (
            <p className="mt-2 text-sm text-rose-300/80">{serverError}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          {serverStatusSteps.map((step, index) => {
            const isCompleted = index < currentIndex || serverStatus === 'READY';
            const isCurrent = index === currentIndex && serverStatus !== 'READY';
            
            return (
              <div key={step.status} className="flex flex-col items-center flex-1">
                <div className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                  ${isCompleted ? 'bg-emerald-500 text-white' : ''}
                  ${isCurrent ? 'bg-brand text-black' : ''}
                  ${!isCompleted && !isCurrent ? 'bg-zinc-700 text-zinc-400' : ''}
                `}>
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <Spinner />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className={`mt-2 text-xs ${isCurrent || isCompleted ? 'text-white' : 'text-zinc-500'}`}>
                  {step.label}
                </span>
                {index < serverStatusSteps.length - 1 && (
                  <div className={`absolute h-0.5 w-full mt-4 ${isCompleted ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MatchDashboard({ matchId }: { matchId: string }) {
  const [data, setData] = useState<MatchDetails | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "error">("idle");
  const [joinOpen, setJoinOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("CHEATING");
  const [reportDetails, setReportDetails] = useState("");
  const [reportTarget, setReportTarget] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const connect = data?.connect ?? data?.serverEndpoint ?? null;
  const lobbyCode = data?.lobbyCode ?? null;
  
  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const next = await api<MatchDetails>(`/matches/${matchId}`);
        if (!alive) return;
        setData(next);
        setErr(null);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load match");
      }
    };

    void load();
    const interval = window.setInterval(load, 3500);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [matchId]);

  const isCancelled = data?.status === "FINISHED" && !!data?.cancelReason;
  const isFinished = data?.status === "FINISHED" && !data?.cancelReason;
  const isPostMatchState = data?.status === "FINISHED";

  const preferredMode = useMemo<"1v1" | "2v2" | "3v3">(() => {
    const raw = (data?.mode ?? "").toLowerCase();
    if (raw.includes("1v1") || raw.includes("one_v_one")) return "1v1";
    if (raw.includes("3v3") || raw.includes("three_v_three")) return "3v3";
    return "2v2";
  }, [data?.mode]);

  const statusLabel = useMemo(() => {
    const status = data?.status ?? "PENDING";
    if (status === "LIVE" && connect) return "Ready";
    if (status === "LIVE") return "Booting";
    if (status === "FINISHED" && data?.cancelReason) return "Cancelled";
    if (status === "FINISHED") return "Finished";
    return "Preparing";
  }, [connect, data?.status, data?.cancelReason]);

  const consoleConnectCmd = useMemo(() => buildConsoleConnectCommand(connect, lobbyCode), [connect, lobbyCode]);

  const handleCopy = async () => {
    if (!consoleConnectCmd) return;
    try {
      await navigator.clipboard.writeText(consoleConnectCmd);
      setCopied("copied");
      setTimeout(() => setCopied("idle"), 1500);
    } catch {
      setCopied("error");
      setTimeout(() => setCopied("idle"), 1500);
    }
  };

  const handleConnect = async () => {
    if (!consoleConnectCmd) return;
    await handleCopy();
    setJoinOpen(true);
  };

  const handleSubmitReport = async () => {
    if (!reportReason) return;
    try {
      setReportStatus("sending");
      setReportMessage(null);
      const token = sessionStorage.getItem("vultstrike_session_token");
      const res = await fetch(`${API_BASE}/matches/${matchId}/report`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          reason: reportReason,
          details: reportDetails?.trim() || undefined,
          reportedHandle: reportTarget?.trim() || undefined
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to submit report");
      }
      const data = await res.json();
      setReportStatus("sent");
      setReportMessage(data?.duplicate ? "Report already submitted for this match." : "Report submitted. Thank you!");
      setReportDetails("");
      setReportTarget("");
    } catch (e) {
      setReportStatus("error");
      setReportMessage(e instanceof Error ? e.message : "Failed to submit report");
    }
  };

  const handleQueueAgain = () => {
    saveMatchmakingIntent({ mode: preferredMode, source: "match-dashboard" });
    window.location.href = "/";
  };

  return (
    <section className="space-y-6">
      <Cs2JoinModal open={joinOpen} onClose={() => setJoinOpen(false)} command={consoleConnectCmd} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Match Dashboard</p>
          <h2 className="mt-2 text-2xl md:text-3xl font-semibold">{matchId}</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Status: <span className="text-white">{statusLabel}</span>
            {data?.lobbyCode ? <span className="text-zinc-500"> · {data.lobbyCode}</span> : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-4 py-2 rounded-full border border-white/10 text-sm hover:border-brand disabled:opacity-60"
            type="button"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
          <button
            className="px-4 py-2 rounded-full border border-white/10 text-sm hover:border-rose-400 text-rose-200 disabled:opacity-60"
            type="button"
            onClick={() => setReportOpen(true)}
          >
            Report
          </button>
          {!isCancelled && (
            <button
              className="px-5 py-2 rounded-full bg-brand text-black font-semibold disabled:opacity-60"
              type="button"
              onClick={handleConnect}
              disabled={!consoleConnectCmd}
            >
              {consoleConnectCmd ? "Join via Console" : "Server preparing"}
            </button>
          )}
        </div>
      </div>

      {err ? (
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
          {err}
        </div>
      ) : null}

      {isCancelled && (
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-5">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
            </svg>
            <div>
              <p className="font-semibold text-rose-300">Match Cancelled</p>
              <p className="mt-1 text-sm text-rose-300/80">{data.cancelReason}</p>
            </div>
          </div>
        </div>
      )}

      {isPostMatchState && (
        <div className={`rounded-2xl border px-4 py-3 ${isFinished ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.24em] ${isFinished ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  {isFinished ? 'Finished' : 'Ended early'}
                </span>
                <p className="text-sm font-medium text-white">
                  {isFinished ? 'Ready for another match?' : 'Want to jump back into queue?'}
                </p>
              </div>
              <p className="mt-2 text-sm text-zinc-300">
                Matchmaking will reopen with {preferredMode} preselected.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black"
                type="button"
                onClick={handleQueueAgain}
              >
                Queue again
              </button>
              <button
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-white hover:border-brand"
                type="button"
                onClick={() => { window.location.href = "/rewards"; }}
              >
                Rewards
              </button>
              <button
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-white hover:border-brand"
                type="button"
                onClick={() => { window.location.href = "/"; }}
              >
                Home
              </button>
            </div>
          </div>
        </div>
      )}

      {!isCancelled && <ServerProgress serverStatus={data?.serverStatus ?? 'PENDING'} serverError={data?.serverError} />}

      <MapCard map={data?.map ?? "loading…"} />

      <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
        <TeamList title="ALPHA" players={data?.teams?.alpha ?? []} teamColor="alpha" />
        <div className="flex flex-col items-center justify-center gap-6 px-4 py-6 rounded-3xl border border-white/10 bg-white/5">
          <ScoreDisplay score={data?.score} status={data?.status} winner={data?.winner} />
          <MatchTimer liveAt={data?.liveAt} durationSeconds={data?.durationSeconds} />
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/30 px-4 py-2">
            {data?.serverStatus === 'READY' ? (
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : data?.serverStatus === 'FAILED' ? (
              <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <Spinner />
            )}
            <span className={`text-sm ${data?.serverStatus === 'READY' ? 'text-emerald-300' : data?.serverStatus === 'FAILED' ? 'text-rose-300' : 'text-zinc-300'}`}>
              {data?.serverStatus === 'READY' ? 'Server ready' : data?.serverStatus === 'FAILED' ? 'Server failed' : 'Server preparing'}
            </span>
          </div>
          <button
            className="px-4 py-2 rounded-full border border-white/10 text-sm hover:border-brand disabled:opacity-60"
            type="button"
            onClick={handleCopy}
            disabled={!connect}
          >
            {copied === "copied" ? "Copied" : copied === "error" ? "Copy failed" : "Copy connect"}
          </button>
        </div>
        <TeamList title="BRAVO" players={data?.teams?.bravo ?? []} teamColor="bravo" />
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-zinc-400">
        <div className="flex items-center justify-between">
          <span>Match Status: <span className="text-white capitalize">{data?.status?.toLowerCase() ?? 'loading'}</span></span>
          <span className="text-xs text-zinc-500">
            {(data?.teams?.alpha?.length ?? 0) + (data?.teams?.bravo?.length ?? 0)} players · {data?.mode ?? 'Unknown mode'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          <div>
            <span className="text-zinc-500">Alpha players: </span>
            <span className="text-sky-400">{data?.teams?.alpha?.filter(p => p.connected).length ?? 0}/{data?.teams?.alpha?.length ?? 0} connected</span>
          </div>
          <div>
            <span className="text-zinc-500">Bravo players: </span>
            <span className="text-amber-400">{data?.teams?.bravo?.filter(p => p.connected).length ?? 0}/{data?.teams?.bravo?.length ?? 0} connected</span>
          </div>
        </div>
        {data?.joinDeadlineAt && (
          <p className="mt-2 text-xs">Join deadline: {new Date(data.joinDeadlineAt).toLocaleString()}</p>
        )}

      </div>

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Report Match</p>
                <h3 className="text-lg font-semibold text-white mt-1">Tell us what happened</h3>
              </div>
              <button
                className="text-zinc-400 hover:text-white"
                type="button"
                onClick={() => setReportOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500">Reason</label>
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                >
                  {reportReasons.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500">Reported player (optional)</label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  placeholder="Steam name or handle"
                  value={reportTarget}
                  onChange={(e) => setReportTarget(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Details (optional)</label>
                <textarea
                  className="mt-1 w-full min-h-[120px] rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  placeholder="Add any details to help us investigate."
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                />
              </div>
              {reportMessage && (
                <div className={`text-xs ${reportStatus === "error" ? "text-rose-300" : "text-emerald-300"}`}>
                  {reportMessage}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-full border border-white/10 text-sm text-zinc-300 hover:border-white/20"
                type="button"
                onClick={() => setReportOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-full bg-rose-500 text-black font-semibold disabled:opacity-60"
                type="button"
                onClick={handleSubmitReport}
                disabled={reportStatus === "sending"}
              >
                {reportStatus === "sending" ? "Sending..." : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
