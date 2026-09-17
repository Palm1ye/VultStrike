"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "./app-state-provider";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();
const MAX_VISIBLE_MESSAGES = 10;
const RATE_LIMIT_DURATION = 30000; // 30 seconds between messages

const RATE_LIMIT_KEY = "shoutbox_rate_limit";

type Shout = {
  id: string;
  message: string;
  createdAt: string;
  user: { id: string; handle: string; displayName: string; steamDisplayName?: string | null };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export function Shoutbox() {
  const { user, session, authenticate } = useAppState();
  const [items, setItems] = useState<Shout[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const displayName = useMemo(() => user?.steamDisplayName ?? user?.displayName ?? user?.handle ?? "guest", [user]);

  // Check rate limit on mount
  useEffect(() => {
    const checkRateLimit = () => {
      const lastSent = localStorage.getItem(RATE_LIMIT_KEY);
      if (lastSent) {
        const elapsed = Date.now() - parseInt(lastSent, 10);
        const remaining = Math.max(0, RATE_LIMIT_DURATION - elapsed);
        setRateLimitRemaining(remaining);
      }
    };
    
    checkRateLimit();
    const interval = setInterval(checkRateLimit, 1000);
    return () => clearInterval(interval);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api<Shout[]>(`/community/shoutbox?limit=30`);
      setItems(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shoutbox");
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(load, 4000);
    return () => window.clearInterval(interval);
  }, [load]);

  // Auto-scroll when new messages arrive, but only if user is near bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    // Check if user is near bottom (within 100px)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    
    if (isNearBottom || items.length <= MAX_VISIBLE_MESSAGES) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [items.length]);

  const send = useCallback(async () => {
    if (busy) return;
    
    // Check rate limit
    const lastSent = localStorage.getItem(RATE_LIMIT_KEY);
    if (lastSent) {
      const elapsed = Date.now() - parseInt(lastSent, 10);
      if (elapsed < RATE_LIMIT_DURATION) {
        const remaining = Math.ceil((RATE_LIMIT_DURATION - elapsed) / 1000);
        setError(`Please wait ${remaining} seconds before sending another message`);
        return;
      }
    }
    
    const msg = draft.trim();
    if (!msg) return;

    try {
      setBusy(true);
      setError(null);
      if (!session) await authenticate();
      setDraft("");
      await api(`/community/shoutbox`, { method: "POST", body: JSON.stringify({ message: msg }) });
      
      // Set rate limit timestamp
      localStorage.setItem(RATE_LIMIT_KEY, Date.now().toString());
      setRateLimitRemaining(RATE_LIMIT_DURATION);
      
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }, [authenticate, busy, draft, load, session]);

  // Show only last MAX_VISIBLE_MESSAGES messages with a scroll indicator if there are more
  const visibleItems = useMemo(() => {
    if (items.length <= MAX_VISIBLE_MESSAGES) return items;
    return items.slice(-MAX_VISIBLE_MESSAGES);
  }, [items]);
  
  const hasMoreMessages = items.length > MAX_VISIBLE_MESSAGES;

  return (
    <div className="glass-panel p-5 space-y-4" id="shoutbox">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Shoutbox</h3>
        <span className="pill">Live</span>
      </div>

      <div 
        ref={messagesContainerRef}
        className="rounded-2xl border border-white/10 bg-black/30 p-3 max-h-[420px] overflow-auto"
      >
        <div className="space-y-3 text-sm">
          {hasMoreMessages && (
            <div className="text-center py-2 text-xs text-zinc-500 border-b border-white/5 mb-2">
              {items.length - MAX_VISIBLE_MESSAGES} older messages
            </div>
          )}
          {visibleItems.length ? (
            visibleItems.map((m) => (
              <div key={m.id} className="shout-row">
                <strong className="text-white">{m.user.steamDisplayName ?? m.user.displayName ?? m.user.handle}</strong>
                <span className="text-zinc-300">{m.message}</span>
              </div>
            ))
          ) : (
            <div className="text-sm text-zinc-500">No shouts yet. Be the first.</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">Posting as {displayName}</div>
          {rateLimitRemaining > 0 && (
            <div className="text-xs text-amber-400">
              Wait {Math.ceil(rateLimitRemaining / 1000)}s
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="w-full rounded-full bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-brand"
            placeholder="Say something…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            disabled={busy || rateLimitRemaining > 0}
            maxLength={280}
          />
          <button
            className="px-5 py-3 rounded-full bg-brand text-black font-semibold disabled:opacity-60"
            type="button"
            onClick={() => void send()}
            disabled={busy || !draft.trim() || rateLimitRemaining > 0}
          >
            Send
          </button>
        </div>
        {error ? <div className="text-xs text-rose-300">{error}</div> : null}
      </div>
    </div>
  );
}
