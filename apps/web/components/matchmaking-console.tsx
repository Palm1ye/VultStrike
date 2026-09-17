"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppState } from "./app-state-provider";
import { useLanguage } from "./language-provider";
import { getApiBase } from "@/lib/api-base";
import { buildConsoleConnectCommand } from "@/lib/steam-connect";
import { Cs2JoinModal } from "./cs2-join-modal";
import { requestMatchFoundNotificationPermission } from "@/lib/match-found-alert";
import { clearMatchmakingIntent, readMatchmakingIntent } from "@/lib/matchmaking-intent";

const API_BASE = getApiBase();

const regions = [
  { code: "EU-C", ping: 46, population: "high", available: true },
  { code: "NA-E", ping: 28, population: "high", available: false, comingSoon: true },
  { code: "SA", ping: 82, population: "medium", available: false, comingSoon: true }
];

const modeOptions = [
  { id: "1v1", labelKey: "queues.1v1.title", rules: "Balanced teams", defaultMaps: "Tirgo, Bluelines, Newage" },
  { id: "2v2", labelKey: "queues.2v2.title", rules: "Captain veto", defaultMaps: "Dust2, Mirage" },
  { id: "3v3", labelKey: "queues.3v3.title", rules: "Fast overtime", defaultMaps: "Dust2, Mirage" }
];

export function MatchmakingConsole() {
  const { t } = useLanguage();
  const { user, session, queue, match, busy, authenticate, joinQueue, leaveQueue, refreshQueue, createParty, joinParty, leaveParty, setPartyReady } = useAppState();
  const [region, setRegion] = useState("EU-C");
  const [mode, setMode] = useState<"1v1" | "2v2" | "3v3">("2v2");
  const [copied, setCopied] = useState<"idle" | "copied" | "error">("idle");
  const [joinOpen, setJoinOpen] = useState(false);
  const [partyCopied, setPartyCopied] = useState<"idle" | "copied" | "error">("idle");
  const [partyCodeInput, setPartyCodeInput] = useState("");
  const [mapPools, setMapPools] = useState<Record<string, string[]> | null>(null);
  const partyDisabled = mode === "1v1";

  const party = useMemo(
    () =>
      queue?.party?.map((member) => ({
        ...member,
        name: user && member.name === user.handle
          ? user.steamDisplayName ?? user.displayName ?? user.handle
          : member.name
      })) ?? [
        { userId: user?.id, name: user?.steamDisplayName ?? user?.displayName ?? user?.handle ?? "guest", role: "Entry", ready: true }
      ],
    [queue, user]
  );
  const readyCount = party.filter((member) => member.ready).length;
  const inParty = Boolean(queue?.partyId);
  const partyCode = queue?.partyCode ?? "";
  const partyModeLabel =
    queue?.partyMode === "ONE_V_ONE" ? "1v1" :
    queue?.partyMode === "TWO_V_TWO" ? "2v2" :
    queue?.partyMode === "THREE_V_THREE" ? "3v3" :
    null;
  const partyRegion = queue?.partyRegion ?? null;
  const leaderName = useMemo(() => {
    if (!queue?.partyLeaderId) return null;
    const leader = party.find((member) => member.userId === queue.partyLeaderId);
    return leader?.name ?? `${queue.partyLeaderId.slice(0, 8)}…`;
  }, [party, queue?.partyLeaderId]);
  const selfMember = useMemo(() => {
    if (!user?.id) return null;
    return party.find((member) => member.userId === user.id) ?? null;
  }, [party, user?.id]);
  const selfReady = selfMember?.ready ?? true;
  const isLeader = !!(queue?.partyLeaderId && user?.id && queue.partyLeaderId === user.id);

  const ensureAuth = useCallback(async () => {
    if (!session) {
      await authenticate();
    }
  }, [session, authenticate]);

  const handleJoinQueue = useCallback(async () => {
    await ensureAuth();
    await requestMatchFoundNotificationPermission();
    await joinQueue(mode, region);
    await refreshQueue();
  }, [ensureAuth, joinQueue, mode, region, refreshQueue]);

  const handleCreateParty = useCallback(async () => {
    await ensureAuth();
    await createParty(mode, region);
    await refreshQueue();
  }, [ensureAuth, createParty, mode, region, refreshQueue]);

  const handleJoinParty = useCallback(async () => {
    await ensureAuth();
    await joinParty(partyCodeInput);
    await refreshQueue();
  }, [ensureAuth, joinParty, partyCodeInput, refreshQueue]);

  const handleLeaveParty = useCallback(async () => {
    await ensureAuth();
    await leaveParty();
    await refreshQueue();
  }, [ensureAuth, leaveParty, refreshQueue]);

  const handleReadyToggle = useCallback(async () => {
    await ensureAuth();
    await setPartyReady(!selfReady);
    await refreshQueue();
  }, [ensureAuth, setPartyReady, selfReady, refreshQueue]);

  const handlePartyQueue = useCallback(async () => {
    if (!partyCode) return;
    await ensureAuth();
    await requestMatchFoundNotificationPermission();
    await joinQueue(mode, region, partyCode);
    await refreshQueue();
  }, [ensureAuth, joinQueue, mode, region, partyCode, refreshQueue]);

  const activeConnect = match?.server?.connect ?? match?.serverEndpoint;
  const activeLobby = match?.lobbyCode ?? queue?.match?.lobbyCode ?? null;
  const consoleCmd = useMemo(() => buildConsoleConnectCommand(activeConnect ?? null, activeLobby), [activeConnect, activeLobby]);

  const shareLobby = useCallback(async () => {
    if (!consoleCmd) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(consoleCmd);
        setCopied("copied");
        setTimeout(() => setCopied("idle"), 2000);
      } else {
        throw new Error("clipboard unavailable");
      }
    } catch {
      setCopied("error");
      setTimeout(() => setCopied("idle"), 2000);
    }
  }, [consoleCmd]);

  const copyPartyCode = useCallback(async () => {
    if (!partyCode) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(partyCode);
        setPartyCopied("copied");
        setTimeout(() => setPartyCopied("idle"), 2000);
      } else {
        throw new Error("clipboard unavailable");
      }
    } catch {
      setPartyCopied("error");
      setTimeout(() => setPartyCopied("idle"), 2000);
    }
  }, [partyCode]);

  const activeMode = useMemo(() => modeOptions.find((option) => option.id === mode), [mode]);

  useEffect(() => {
    const intent = readMatchmakingIntent();
    if (!intent?.mode) return;
    setMode(intent.mode);
    clearMatchmakingIntent();
  }, []);

  useEffect(() => {
    if (!queue?.partyId) return;
    if (partyModeLabel && partyModeLabel !== mode) {
      setMode(partyModeLabel as "1v1" | "2v2" | "3v3");
    }
    if (partyRegion && partyRegion !== region) {
      setRegion(partyRegion);
    }
  }, [queue?.partyId, partyModeLabel, partyRegion, mode, region]);

  useEffect(() => {
    let active = true;
    async function loadPools() {
      try {
        const res = await fetch(`${API_BASE}/maps/pool/${mode}`, { cache: "no-store" }).then((r) => r.json());
        if (!active) return;
        setMapPools((prev) => ({
          ...(prev ?? {}),
          [mode]: Array.isArray(res?.maps) ? res.maps : []
        }));
      } catch {
        if (active) setMapPools((prev) => prev ?? null);
      }
    }
    void loadPools();
    return () => {
      active = false;
    };
  }, [mode]);

  const handleConnect = useCallback(async () => {
    if (!consoleCmd) return;
    await shareLobby();
    setJoinOpen(true);
  }, [consoleCmd, shareLobby]);

  return (
    <div className="glass-panel p-4 space-y-4" id="matchmaking">
      <Cs2JoinModal open={joinOpen} onClose={() => setJoinOpen(false)} command={consoleCmd} />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-zinc-400">{t("matchmaking.title")}</p>
            <h3 className="text-2xl font-semibold">{t("matchmaking.subtitle")}</h3>
          </div>
          <div className="rounded-full bg-white/5 px-3 py-2 text-xs text-zinc-300">
            {user ? `Signed in as ${user.handle}` : "Guest"} · {t(`matchmaking.population.high`)}
          </div>
        </div>
        
        {/* Match Status Banner */}
        {match?.id || queue?.match?.id ? (
          <div className="rounded-2xl border border-brand/30 bg-brand/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand font-bold">Match Found!</p>
                <p className="text-lg font-semibold mt-1">
                  {match?.map || queue?.match?.map || "Preparing map..."}
                </p>
                <p className="text-sm text-zinc-400">
                  Match ID: {(match?.id || queue?.match?.id || "").slice(0, 8)}... · Status: {match?.status || queue?.match?.status || "PENDING"}
                </p>
              </div>
              <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            {(match?.lobbyCode || queue?.match?.lobbyCode) && (
              <p className="text-xs text-zinc-500 mt-2">Lobby: {match?.lobbyCode || queue?.match?.lobbyCode}</p>
            )}
            {(match?.serverEndpoint || queue?.match?.serverEndpoint) && (
              <p className="text-xs text-zinc-500">Server: {match?.serverEndpoint || queue?.match?.serverEndpoint}</p>
            )}
          </div>
        ) : queue?.pending ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-rose-300 font-bold">{t("matchmaking.pendingTitle")}</p>
                <p className="text-lg font-semibold mt-1">{t("matchmaking.pendingSubtitle")}</p>
                <p className="text-sm text-zinc-400">
                  {t("matchmaking.pendingDetail", {
                    active: queue.pending.activeMatches,
                    eta: queue.pending.etaSeconds
                  })}
                </p>
              </div>
              <div className="h-3 w-3 rounded-full bg-rose-400 animate-pulse" />
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              {t("matchmaking.pendingFooter", { seconds: queue.pending.retryAfterSeconds })}
            </p>
          </div>
        ) : queue?.activeTicket ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-400">Searching for Match...</p>
                <p className="text-lg font-semibold mt-1">Ticket: {queue.activeTicket}</p>
                <p className="text-sm text-zinc-400">Mode: {mode.toUpperCase()} · Region: {region}</p>
              </div>
              <div className="h-4 w-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              ETA ~{queue.etaSeconds}s · Searching for {mode === "1v1" ? "1" : mode === "2v2" ? "3" : "5"} more players
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/5 bg-black/30 p-3 text-sm text-zinc-300">
            <div className="flex items-center justify-between">
              <span>Join a queue to start matchmaking</span>
              <span className="text-xs text-zinc-500">--</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Select a mode and region, then click Join Queue
            </p>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-xs text-zinc-500">{t("matchmaking.mode")}</p>
          <p className="text-lg font-semibold">{activeMode ? t(activeMode.labelKey) : mode.toUpperCase()}</p>
          <p className="text-xs text-emerald-300">{queue?.preferredRegions?.[0] ?? region}</p>
        </div>
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-xs text-zinc-500">Map pool</p>
          <p className="text-lg font-semibold">
            {mapPools?.[mode]?.length ? mapPools[mode].join(", ") : activeMode?.defaultMaps}
          </p>
          <p className="text-xs text-zinc-400">Rotation based on current pool</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {modeOptions.map((option) => (
          <button
            key={option.id}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === option.id ? "border-brand bg-brand/10" : "border-white/5"
            }`}
            type="button"
            onClick={() => setMode(option.id as "1v1" | "2v2" | "3v3")}
          >
            <p className="text-xs text-zinc-500">{t("matchmaking.mode")}</p>
            <p className="text-xl font-semibold">{t(option.labelKey)}</p>
            <p className="text-xs text-zinc-400">{option.rules}</p>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {regions.map((regionOption) => (
          <button
            key={regionOption.code}
            className={`rounded-2xl border p-4 text-left transition relative overflow-hidden ${
              region === regionOption.code && regionOption.available
                ? "border-brand bg-brand/10"
                : regionOption.available
                  ? "border-white/5 hover:border-white/20"
                  : "border-white/5 opacity-60 cursor-not-allowed"
            }`}
            type="button"
            onClick={() => regionOption.available && setRegion(regionOption.code)}
            disabled={!regionOption.available}
          >
            {!regionOption.available && regionOption.comingSoon && (
              <div className="absolute top-2 right-2">
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                  Coming Soon
                </span>
              </div>
            )}
            <p className="text-xs text-zinc-500">
              {t("matchmaking.region")}: {t(`matchmaking.population.${regionOption.population}`)}
            </p>
            <p className="text-xl font-semibold">{regionOption.code}</p>
            <p className={`text-sm ${regionOption.available ? "text-emerald-300" : "text-zinc-500"}`}>
              {regionOption.available ? `${regionOption.ping} ms` : "Unavailable"}
            </p>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">{t("matchmaking.party")}</p>
          <span className="text-xs text-zinc-500">{t("matchmaking.partySummary", { ready: readyCount, size: party.length, lobby: match?.lobbyCode ?? "pending" })}</span>
        </div>
        <div className="rounded-2xl border border-white/5 bg-black/30 p-4 space-y-3">
          {inParty ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-zinc-500">{t("party.code")}</p>
                  <p className="text-lg font-semibold">{partyCode || "pending"}</p>
                  {leaderName && (
                    <p className="text-xs text-zinc-500">{t("party.leader")}: {leaderName}</p>
                  )}
                </div>
                <button
                  className="px-3 py-2 rounded-full border border-white/10 text-xs text-white hover:border-brand disabled:opacity-60"
                  type="button"
                  onClick={copyPartyCode}
                  disabled={!partyCode}
                >
                  {partyCopied === "copied"
                    ? t("party.copied")
                    : partyCopied === "error"
                      ? t("party.copyFailed")
                      : t("party.copy")}
                </button>
              </div>
              {(partyModeLabel || partyRegion) && (
                <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                  {partyModeLabel && <span>{t("party.mode")}: {partyModeLabel}</span>}
                  {partyRegion && <span>{t("party.region")}: {partyRegion}</span>}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  className="px-4 py-2 rounded-full border border-emerald-400/40 text-emerald-200 hover:border-emerald-300 disabled:opacity-60"
                  type="button"
                  onClick={handleReadyToggle}
                  disabled={busy.queue}
                >
                  {selfReady ? t("party.unready") : t("party.ready")}
                </button>
                <button
                  className="px-4 py-2 rounded-full border border-red-500/50 text-red-300 hover:border-red-400 disabled:opacity-60"
                  type="button"
                  onClick={handleLeaveParty}
                  disabled={busy.queue}
                >
                  {t("party.leave")}
                </button>
                {isLeader ? (
                  <button
                    className="px-4 py-2 rounded-full bg-brand text-black font-semibold disabled:opacity-60"
                    type="button"
                    onClick={handlePartyQueue}
                    disabled={busy.queue}
                  >
                    {t("party.startQueue")}
                  </button>
                ) : (
                  <span className="text-xs text-zinc-500 self-center">{t("party.waitLeader")}</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  className="px-4 py-2 rounded-full bg-brand text-black font-semibold disabled:opacity-60"
                  type="button"
                  onClick={handleCreateParty}
                  disabled={busy.queue || partyDisabled}
                >
                  {t("party.create")}
                </button>
                {partyDisabled && (
                  <span className="text-xs text-zinc-500 self-center">{t("party.disabled1v1")}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  className="flex-1 min-w-[200px] rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-brand"
                  type="text"
                  value={partyCodeInput}
                  onChange={(event) => setPartyCodeInput(event.target.value)}
                  placeholder={t("party.joinPlaceholder")}
                />
                <button
                  className="px-4 py-2 rounded-full border border-white/10 text-white hover:border-brand disabled:opacity-60"
                  type="button"
                  onClick={handleJoinParty}
                  disabled={busy.queue}
                >
                  {t("party.join")}
                </button>
              </div>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-white/5 divide-y divide-white/5 bg-black/30 max-h-48 overflow-auto">
          {party.map((member) => (
            <div key={member.userId ?? member.name} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-semibold">{member.name}</p>
                <p className="text-xs text-zinc-500">{member.role}</p>
              </div>
              <span className={`text-xs ${member.ready ? "text-emerald-300" : "text-amber-300"}`}>
                {member.ready ? t("matchmaking.ready") : t("matchmaking.warmup")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Show Join Queue button only when not in a match and no active ticket */}
        {!match?.id && !queue?.match?.id && !queue?.activeTicket && !inParty && (
          <button
            className="px-5 py-3 rounded-full bg-brand text-black font-semibold disabled:opacity-60"
            type="button"
            onClick={handleJoinQueue}
            disabled={busy.queue}
          >
            {busy.queue ? t("matchmaking.joining") : t("matchmaking.searching")}
          </button>
        )}
        
        {/* Show Leave Queue button when searching */}
        {queue?.activeTicket && !match?.id && !queue?.match?.id && (
          <button
            className="px-5 py-3 rounded-full border border-red-500/50 text-red-400 hover:border-red-500 hover:bg-red-500/10 disabled:opacity-60"
            type="button"
            onClick={leaveQueue}
            disabled={busy.queue}
          >
            {busy.queue ? "Leaving..." : "Leave Queue"}
          </button>
        )}
        
        {/* Show Open Match Dashboard button when match is found */}
        {(match?.id || queue?.match?.id) && (
          <button
            className="px-5 py-3 rounded-full bg-emerald-500 text-black font-semibold hover:bg-emerald-400"
            type="button"
            onClick={() => window.open(`/match/${match?.id ?? queue?.match?.id}`, "_blank")}
          >
            Open Match Dashboard
          </button>
        )}
        
        <button
          className="px-5 py-3 rounded-full border border-white/10 text-white hover:border-brand disabled:opacity-60"
          type="button"
          onClick={handleConnect}
          disabled={!consoleCmd}
        >
          {consoleCmd ? "Join via Console" : "Waiting for server"}
        </button>
        <button
          className="px-5 py-3 rounded-full border border-white/10 text-white hover:border-brand disabled:opacity-60"
          type="button"
          onClick={shareLobby}
          disabled={!consoleCmd}
        >
          {copied === "copied" ? "Copied" : copied === "error" ? "Copy failed" : consoleCmd ? "Copy join command" : "Waiting for server"}
        </button>
        <span className="text-xs text-zinc-500">
          {queue?.penaltyFreeDodges !== undefined
            ? t("matchmaking.dodges", { count: queue.penaltyFreeDodges })
            : t("matchmaking.dodges", { count: 2 })}
        </span>
      </div>
    </div>
  );
}
