"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "./app-state-provider";
import { buildConsoleConnectCommand } from "@/lib/steam-connect";
import { Cs2JoinModal } from "./cs2-join-modal";
import { showMatchFoundNotification } from "@/lib/match-found-alert";

const LAST_SEEN_KEY = "vultstrike_last_seen_match";

function playMatchFoundAlert() {
  if (typeof window === "undefined") return null;

  const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor({ latencyHint: "interactive" });
  const master = context.createGain();
  master.gain.value = 0.25;
  master.connect(context.destination);

  const now = context.currentTime + 0.05;
  const notes = [659.25, 783.99, 987.77, 1318.51];

  void context.resume().catch(() => undefined);

  notes.forEach((frequency, index) => {
    const start = now + index * 0.12;
    const osc1 = context.createOscillator();
    const osc2 = context.createOscillator();
    const gain = context.createGain();

    osc1.type = "triangle";
    osc2.type = "sine";

    osc1.frequency.setValueAtTime(frequency, start);
    osc2.frequency.setValueAtTime(frequency * 2, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(master);

    osc1.start(start);
    osc2.start(start);
    osc1.stop(start + 0.7);
    osc2.stop(start + 0.7);
  });

  const cleanupAt = (now + (notes.length - 1) * 0.12 + 0.9 - context.currentTime) * 1000;
  const timeoutId = window.setTimeout(() => {
    void context.close().catch(() => undefined);
  }, Math.max(cleanupAt, 1000));

  return () => {
    window.clearTimeout(timeoutId);
    void context.close().catch(() => undefined);
  };
}

export function MatchFoundPopup() {
  const { queue, match, user } = useAppState();
  const [open, setOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const cleanupAlertRef = useRef<(() => void) | null>(null);
  const notificationRef = useRef<Notification | null>(null);
  const matchId = queue?.match?.id ?? match?.id ?? null;

  const map = queue?.match?.map ?? match?.map ?? "";
  const lobbyCode = queue?.match?.lobbyCode ?? match?.lobbyCode ?? "";
  const serverConnect = queue?.match?.connect ?? match?.serverEndpoint ?? null;
  const consoleCmd = useMemo(() => buildConsoleConnectCommand(serverConnect, lobbyCode), [serverConnect, lobbyCode]);

  const partyNames = useMemo(() => {
    const party = queue?.party ?? [];
    if (party.length) {
      return party.map((p) =>
        user && p.name === user.handle
          ? user.steamDisplayName ?? user.displayName ?? user.handle
          : p.name
      );
    }
    return user?.steamDisplayName ?? user?.displayName ?? user?.handle ? [user.steamDisplayName ?? user.displayName ?? user.handle] : [];
  }, [queue?.party, user]);

  useEffect(() => {
    if (!matchId) {
      setOpen(false);
      cleanupAlertRef.current?.();
      cleanupAlertRef.current = null;
      notificationRef.current?.close();
      notificationRef.current = null;
      return;
    }
    
    // Always show popup when a new match is found (different from last seen)
    const lastSeen = sessionStorage.getItem(LAST_SEEN_KEY);
    
    // Show popup if:
    // 1. No last seen match (first time)
    // 2. Different match ID (new match)
    if (lastSeen !== matchId) {
      sessionStorage.setItem(LAST_SEEN_KEY, matchId);
      setOpen(true);
      cleanupAlertRef.current?.();
      cleanupAlertRef.current = playMatchFoundAlert();
      notificationRef.current?.close();
      notificationRef.current = showMatchFoundNotification({ map, lobbyCode, matchId });
    }
  }, [lobbyCode, map, matchId]);

  useEffect(() => {
    if (!open) {
      cleanupAlertRef.current?.();
      cleanupAlertRef.current = null;
    }
  }, [open]);

  useEffect(() => () => {
    cleanupAlertRef.current?.();
    notificationRef.current?.close();
  }, []);

  if (!open || !matchId) return null;

  const openDashboard = () => {
    window.open(`/match/${matchId}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Match found"
      onClick={() => setOpen(false)}
    >
      <div
        className="glass-panel w-full max-w-xl p-5 md:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Cs2JoinModal open={joinOpen} onClose={() => setJoinOpen(false)} command={consoleCmd} />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-400">Match found</p>
            <h3 className="mt-2 text-2xl font-semibold">{map || "Preparing"}</h3>
            <p className="mt-1 text-xs text-zinc-500">{lobbyCode ? `Lobby ${lobbyCode}` : `Match ${matchId}`}</p>
          </div>
          <button className="btn-ghost" type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Players</p>
            <span className="text-xs text-zinc-500">Auto-updates on dashboard</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(partyNames.length ? partyNames : ["Player A", "Player B"]).slice(0, 2).map((name) => {
              // Get MMR info from user if available - use a default since mode is not in queue.match
              const userMmr = user?.mmr?.['1v1'] ?? 0;
              const userLevel = Math.floor(userMmr / 500) + 1;
              return (
                <div key={name} className="rounded-xl bg-white/5 px-3 py-3">
                  <p className="font-semibold">{name}</p>
                  <p className="text-xs text-zinc-500">
                    {userMmr > 0 ? `MMR: ${userMmr} · Level: ${Math.min(userLevel, 10)}` : 'MMR: — · Level: —'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Server Connection Info */}
        {serverConnect ? (
          <div className="rounded-2xl border border-brand/30 bg-brand/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand">Server Ready</p>
                <p className="mt-1 text-sm font-mono text-white">{consoleCmd ?? serverConnect}</p>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-4 py-2 rounded-full bg-brand text-black font-semibold text-sm"
                  type="button"
                  onClick={() => {
                    if (!consoleCmd) return;
                    navigator.clipboard.writeText(consoleCmd).catch(() => undefined);
                    setJoinOpen(true);
                  }}
                >
                  Connect
                </button>
                <button
                  className="px-4 py-2 rounded-full border border-white/20 text-white text-sm hover:border-brand"
                  type="button"
                  onClick={() => {
                    if (!consoleCmd) return;
                    navigator.clipboard.writeText(consoleCmd).catch(() => undefined);
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-brand animate-spin" />
              <p className="text-sm text-zinc-400">Server is preparing...</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button className="px-5 py-3 rounded-full bg-brand text-black font-semibold" type="button" onClick={openDashboard}>
            Open match dashboard
          </button>
          <button
            className="px-5 py-3 rounded-full border border-white/10 text-white hover:border-brand"
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(window.location.origin + `/match/${matchId}`).catch(() => undefined);
            }}
          >
            Copy dashboard link
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          {serverConnect
            ? "Click Connect to copy the console join command and see how to join."
            : "Next: you'll see a 'Server Ready' message once the server is ready."}
        </p>
      </div>
    </div>
  );
}
