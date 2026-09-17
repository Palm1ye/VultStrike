"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

type Session = { token: string; userId: string; userHandle: string };
const SESSION_TOKEN_KEY = "vultstrike_session_token";
const SESSION_USER_KEY = "vultstrike_session_user";
const SESSION_KIND_KEY = "vultstrike_session_kind";
const SESSION_COOKIE_NAME = "vultstrike_session";

type UserProfile = {
  id: string;
  handle: string;
  displayName: string;
  role: "USER" | "MODERATOR" | "ADMIN";
  trustScore: number;
  steamDisplayName: string | null;
  steamAvatar: string | null;
  steamId?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banUntil?: string | null;
  mmr: Record<string, number>;
  stats?: {
    wins: number;
    losses: number;
    draws?: number;
    matches?: number;
    winRate?: number | null;
  } | null;
  placement?: {
    "1v1"?: { matches: number; completed: boolean } | null;
    "2v2"?: { matches: number; completed: boolean } | null;
    "3v3"?: { matches: number; completed: boolean } | null;
  } | null;
  lastMatch?: {
    id: string;
    map: string | null;
    status: string;
    mmrDelta: number | null;
    completedAt: string | null;
  } | null;
  recentMatches?: Array<{
    id: string;
    map: string | null;
    status: string;
    mmrDelta: number | null;
    scoreAlpha?: number | null;
    scoreBravo?: number | null;
    winner?: string | null;
    completedAt: string | null;
  }> | null;
};

type QueuePartyMember = { userId?: string; name: string; role: string; ready: boolean };

type QueueStatus = {
  activeTicket: string | null;
  etaSeconds: number;
  preferredRegions: string[];
  penaltyFreeDodges: number;
  pending?: {
    mode: string;
    region: string;
    activeMatches: number;
    etaSeconds: number;
    retryAfterSeconds: number;
  };
  match?: {
    id: string;
    status: string;
    map: string;
    lobbyCode: string;
    serverEndpoint?: string | null;
    connect?: string | null;
  } | null;
  party: QueuePartyMember[];
  partyId?: string | null;
  partyCode?: string | null;
  partyLeaderId?: string | null;
  partyMode?: string | null;
  partyRegion?: string | null;
};

type ServerInfo = { id: string; region: string; endpoint: string; connect: string; lobbyCode: string };

type MatchState = {
  id: string;
  mode: string;
  map: string;
  status: string;
  lobbyCode: string | null;
  serverEndpoint: string | null;
  server?: ServerInfo;
};

type PartyMember = {
  userId: string;
  role?: string | null;
  ready?: boolean | null;
  handle?: string | null;
  displayName?: string | null;
};

type PartyResponse = {
  id: string;
  code: string;
  leaderUserId: string;
  mode?: string | null;
  region?: string | null;
  status?: string | null;
  members: PartyMember[];
};

type Notice = { type: "info" | "success" | "error"; message: string } | null;

type AppState = {
  session: Session | null;
  user: UserProfile | null;
  queue: QueueStatus | null;
  match: MatchState | null;
  notice: Notice;
  busy: { auth: boolean; queue: boolean };
  authenticate: (identifier?: string) => Promise<void>;
  signOut: () => void;
  joinQueue: (mode: string, region?: string, partyCode?: string) => Promise<void>;
  leaveQueue: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  createParty: (mode: string, region?: string) => Promise<void>;
  joinParty: (code: string) => Promise<void>;
  leaveParty: () => Promise<void>;
  setPartyReady: (ready: boolean) => Promise<void>;
  clearNotice: () => void;
  notify: (notice: NonNullable<Notice>) => void;
};

const AppStateContext = createContext<AppState | undefined>(undefined);

class HttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(body || `Request failed: ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = typeof init?.body !== "undefined" && init.body !== null;
  // Get token from sessionStorage for authorization
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: init?.credentials ?? "include",
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, text);
  }

  return res.json() as Promise<T>;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState({ auth: false, queue: false });
  const joinRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJoinRef = useRef<{ mode: string; region: string; partyCode?: string } | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const profile = await api<{
      id: string;
      handle: string;
      displayName: string;
      role: "USER" | "MODERATOR" | "ADMIN";
      trustScore: number;
      steamDisplayName: string | null;
      steamAvatar: string | null;
      steamId?: string | null;
      banned?: boolean | null;
      banReason?: string | null;
      banUntil?: string | null;
      mmr: Record<string, number>;
      placement?: {
        "1v1"?: { matches: number; completed: boolean } | null;
        "2v2"?: { matches: number; completed: boolean } | null;
        "3v3"?: { matches: number; completed: boolean } | null;
      } | null;
      lastMatch?: {
        id: string;
        map: string | null;
        status: string;
        mmrDelta: number | null;
        completedAt: string | null;
      } | null;
      recentMatches?: Array<{
        id: string;
        map: string | null;
        status: string;
        mmrDelta: number | null;
        scoreAlpha?: number | null;
        scoreBravo?: number | null;
        winner?: string | null;
        completedAt: string | null;
      }> | null;
      stats?: {
        wins: number;
        losses: number;
        draws?: number;
        matches?: number;
        winRate?: number | null;
      } | null;
    }>(`/account/${userId}`);

    // Ensure displayName is never empty - fallback to steamDisplayName or handle
    const effectiveDisplayName = profile.displayName?.trim() 
      || profile.steamDisplayName?.trim() 
      || profile.handle 
      || "Steam User";
    
    setUser({
      id: profile.id,
      handle: profile.handle,
      displayName: effectiveDisplayName,
      role: profile.role,
      trustScore: profile.trustScore,
      steamDisplayName: profile.steamDisplayName,
      steamAvatar: profile.steamAvatar,
      steamId: profile.steamId ?? null,
      banned: profile.banned ?? false,
      banReason: profile.banReason ?? null,
      banUntil: profile.banUntil ?? null,
      mmr: profile.mmr,
      placement: profile.placement ?? null,
      lastMatch: profile.lastMatch ?? null,
      recentMatches: profile.recentMatches ?? null,
      stats: profile.stats ?? null
    });
  }, []);

  const hydrateFromSession = useCallback(async () => {
    try {
      const session = await api<{ userId: string; handle?: string; provider?: string }>("/auth/me");
      if (!session.userId) return;
      setSession({ token: "cookie", userId: session.userId, userHandle: session.handle ?? session.userId });
      const existingKind = localStorage.getItem(SESSION_KIND_KEY);
      if (existingKind !== "guest") {
        localStorage.setItem(SESSION_KIND_KEY, session.provider ?? "steam");
      }
      // Keep an existing bearer token if it matches the authenticated user.
      // This avoids stale/invalid cookies breaking API requests on some clients.
      const storedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const storedUserId = sessionStorage.getItem(SESSION_USER_KEY);
      if (!storedToken || storedUserId !== session.userId) {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_USER_KEY);
      }
      await loadProfile(session.userId);
    } catch (err) {
      // If the API is temporarily unavailable, do not clobber an existing session.
      // Only treat explicit 401/403 as an expired session.
      if (!(err instanceof HttpError)) return;
      if (err.status !== 401 && err.status !== 403) return;

      const rememberedKind = localStorage.getItem(SESSION_KIND_KEY);
      const hadPersistedIdentity =
        Boolean(sessionStorage.getItem(SESSION_TOKEN_KEY)) ||
        Boolean(localStorage.getItem(SESSION_USER_KEY)) ||
        Boolean(rememberedKind);

      // If /auth/me returns 401/403, the session is invalid. Do not keep stale user state,
      // otherwise the UI can look "signed in" while protected endpoints fail.
      setSession(null);
      setUser(null);
      setQueue(null);
      setMatch(null);
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);
      localStorage.removeItem(SESSION_USER_KEY);
      localStorage.removeItem(SESSION_KIND_KEY);

      if (hadPersistedIdentity && rememberedKind !== "guest") {
        setNotice({ type: "info", message: "Session expired. Please sign in again." });
      }
    }
  }, [loadProfile]);

  const authenticate = useCallback(async (identifier = "steam") => {
    try {
      setBusy((b) => ({ ...b, auth: true }));
      if (identifier === "steam") {
        const returnTo = window.location.href;
        window.location.href = `${API_BASE}/auth/steam?returnTo=${encodeURIComponent(returnTo)}`;
        return;
      }
      const rememberedKind = localStorage.getItem(SESSION_KIND_KEY);
      if (identifier === "guest" && rememberedKind && rememberedKind !== "guest") {
        setNotice({ type: "info", message: "Session expired. Please sign in again." });
        const returnTo = window.location.href;
        window.location.href = `${API_BASE}/auth/steam?returnTo=${encodeURIComponent(returnTo)}`;
        return;
      }
      const auth = await api<{
        ok: boolean;
        sessionToken: string;
        userId: string;
        userHandle: string;
      }>("/auth/session", {
        method: "POST",
        body: JSON.stringify({ provider: "email", identifier })
      });

      setSession({ token: auth.sessionToken, userId: auth.userId, userHandle: auth.userHandle });
      sessionStorage.setItem(SESSION_TOKEN_KEY, auth.sessionToken);
      sessionStorage.setItem(SESSION_USER_KEY, auth.userId);
      localStorage.setItem(SESSION_USER_KEY, auth.userId);
      localStorage.setItem(SESSION_KIND_KEY, identifier === "guest" ? "guest" : "email");
      await loadProfile(auth.userId);
      setNotice({ type: "success", message: `Signed in as ${auth.userHandle}` });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to authenticate" });
    } finally {
      setBusy((b) => ({ ...b, auth: false }));
    }
  }, [loadProfile]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authToken = params.get("authToken");
    const userId = params.get("userId");
    if (authToken && userId) {
      // Set token as cookie for API requests (host + domain cookie)
      const maxAge = 7 * 24 * 60 * 60;
      const secure = window.location.protocol === "https:";
      const base = `${SESSION_COOKIE_NAME}=${authToken}; path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? "; Secure" : ""}`;
      document.cookie = base;
      if (window.location.hostname.endsWith("vultstrike.com")) {
        document.cookie = `${base}; domain=.vultstrike.com`;
      }
      sessionStorage.setItem(SESSION_TOKEN_KEY, authToken);
      sessionStorage.setItem(SESSION_USER_KEY, userId);
      localStorage.setItem(SESSION_USER_KEY, userId);
      localStorage.setItem(SESSION_KIND_KEY, "steam");
      setSession({ token: authToken, userId, userHandle: userId });
      void loadProfile(userId);
      params.delete("authToken");
      params.delete("userId");
      const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`.replace(/\?$/, "");
      window.history.replaceState({}, "", next);
      return;
    }
    void hydrateFromSession();
  }, [hydrateFromSession, loadProfile]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void hydrateFromSession();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [hydrateFromSession]);

  useEffect(() => {
    if (session?.userId && !user) {
      void loadProfile(session.userId);
    }
  }, [session?.userId, user, loadProfile]);

  const expireSession = useCallback((message = "Session expired. Please sign in again.") => {
    setSession(null);
    setUser(null);
    setQueue(null);
    setMatch(null);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_KIND_KEY);
    setNotice({ type: "info", message });
    if (joinRetryRef.current) {
      clearTimeout(joinRetryRef.current);
      joinRetryRef.current = null;
    }
    pendingJoinRef.current = null;
  }, []);

  const handleAuthFailure = useCallback((err: unknown) => {
    if (!(err instanceof HttpError)) return false;
    if (err.status !== 401 && err.status !== 403) return false;
    expireSession();
    return true;
  }, [expireSession]);

  const signOut = useCallback(() => {
    void api("/auth/logout", { method: "POST" }).catch(() => undefined);
    const secure = window.location.protocol === "https:";
    const clearBase = `${SESSION_COOKIE_NAME}=; path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`;
    document.cookie = clearBase;
    if (window.location.hostname.endsWith("vultstrike.com")) {
      document.cookie = `${clearBase}; domain=.vultstrike.com`;
    }
    setSession(null);
    setUser(null);
    setQueue(null);
    setMatch(null);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_KIND_KEY);
    setNotice({ type: "info", message: "Signed out." });
    if (joinRetryRef.current) {
      clearTimeout(joinRetryRef.current);
      joinRetryRef.current = null;
    }
    pendingJoinRef.current = null;
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!session) return;
    try {
      setBusy((b) => ({ ...b, queue: true }));
      // Use server-authenticated identity to avoid stale local userId mismatches (guest -> steam, etc.)
      const status = await api<QueueStatus>(`/account/me/queue`);
      setQueue((prev) => {
        if (prev?.pending && !status.activeTicket && !status.match) {
          return { ...status, pending: prev.pending };
        }
        return status;
      });
      const activeMatch = status.match ?? null;
      if (activeMatch) {
        setMatch((prev) => ({
          id: activeMatch.id ?? prev?.id ?? "",
          mode: prev?.mode ?? "2v2",
          map: activeMatch.map ?? prev?.map ?? "",
          status: activeMatch.status ?? prev?.status ?? "PENDING",
          lobbyCode: activeMatch.lobbyCode ?? prev?.lobbyCode ?? null,
          serverEndpoint: activeMatch.serverEndpoint ?? prev?.serverEndpoint ?? null,
          server: activeMatch.serverEndpoint
            ? {
                id: prev?.server?.id ?? "",
                region: prev?.server?.region ?? "",
                endpoint: activeMatch.serverEndpoint ?? prev?.server?.endpoint ?? "",
                connect: activeMatch.serverEndpoint,
                lobbyCode: activeMatch.lobbyCode ?? prev?.server?.lobbyCode ?? ""
              }
            : prev?.server
        }));
      }
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to load queue" });
    } finally {
      setBusy((b) => ({ ...b, queue: false }));
    }
  }, [handleAuthFailure, session]);

  // Poll queue status every 5 seconds when user has an active ticket or match
  useEffect(() => {
    if (!session) return;
    if (!queue?.activeTicket && !queue?.match && !queue?.pending && !match?.id) return;
    // Poll only while queueing or in a match to reduce background traffic
    const interval = window.setInterval(() => {
      void refreshQueue();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [session, queue?.activeTicket, queue?.match, queue?.pending, match?.id, refreshQueue]);

  const joinQueue = useCallback(
    async (mode: string, region = "GLOBAL", partyCode?: string) => {
      if (!session) {
        setNotice({ type: "error", message: "Sign in first to join queues." });
        return;
      }
      try {
        setBusy((b) => ({ ...b, queue: true }));
        const payload: { mode: string; region: string; partyCode?: string } = {
          mode,
          region
        };
        if (partyCode?.trim()) payload.partyCode = partyCode.trim();
        const res = await api<{
          ok: boolean;
          ticket?: string;
          etaSeconds?: number;
          region?: string;
          warning?: string | null;
          error?: string;
          status?: string;
          retryAfter?: number;
          activeMatches?: number;
          estimatedWaitSeconds?: number;
        }>("/queues/join", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          if (res.status === "critical") {
            const retryAfterSeconds = res.retryAfter ?? 300;
            const etaSeconds = res.estimatedWaitSeconds ?? retryAfterSeconds;
            const activeMatches = res.activeMatches ?? 0;
            setNotice({
              type: "info",
              message: "Matchmaking queued due to high server load. We'll retry shortly."
            });
            setQueue((prev) => ({
              activeTicket: null,
              etaSeconds,
              preferredRegions: [region],
              penaltyFreeDodges: prev?.penaltyFreeDodges ?? 3,
              match: null,
              party: prev?.party ?? [{ name: user?.handle ?? "guest", role: "Entry", ready: true }],
              pending: { mode, region, activeMatches, etaSeconds, retryAfterSeconds }
            }));
            if (joinRetryRef.current) {
              clearTimeout(joinRetryRef.current);
            }
            pendingJoinRef.current = { mode, region, partyCode: partyCode?.trim() };
            joinRetryRef.current = setTimeout(() => {
              if (!pendingJoinRef.current) return;
              void joinQueue(pendingJoinRef.current.mode, pendingJoinRef.current.region, pendingJoinRef.current.partyCode);
            }, retryAfterSeconds * 1000);
          } else {
            setNotice({ type: "error", message: res.error || "Failed to join queue" });
          }
          return;
        }

        if (!res.ticket || !res.region || typeof res.etaSeconds !== "number") {
          throw new Error("Invalid queue response");
        }
        const ticket = res.ticket!;
        const etaSeconds = res.etaSeconds!;
        const resolvedRegion = res.region!;

        // Immediately update queue state with the ticket info
        setQueue((prev) => ({
          activeTicket: ticket,
          etaSeconds: etaSeconds,
          preferredRegions: [resolvedRegion],
          penaltyFreeDodges: prev?.penaltyFreeDodges ?? 3,
          match: prev?.match ?? null,
          party: prev?.party ?? [{ name: user?.handle ?? "guest", role: "Entry", ready: true }],
          pending: undefined
        }));

        if (joinRetryRef.current) {
          clearTimeout(joinRetryRef.current);
          joinRetryRef.current = null;
        }
        pendingJoinRef.current = null;
        
        if (res.warning) {
          setNotice({ type: "info", message: res.warning });
        } else {
          setNotice({ type: "success", message: `Joined ${mode}. Ticket ${ticket}. ETA ~${etaSeconds}s` });
        }
        
        // Also refresh to get full status from server
        await refreshQueue();
      } catch (err) {
        if (handleAuthFailure(err)) return;
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to join queue" });
      } finally {
        setBusy((b) => ({ ...b, queue: false }));
      }
    },
    [handleAuthFailure, session, user?.handle, refreshQueue]
  );

  const createParty = useCallback(
    async (mode: string, region = "GLOBAL") => {
      if (!session) {
        setNotice({ type: "error", message: "Sign in first to create a party." });
        return;
      }
      try {
        setBusy((b) => ({ ...b, queue: true }));
        const party = await api<PartyResponse>("/party/create", {
          method: "POST",
          body: JSON.stringify({ mode, region })
        });
        setNotice({ type: "success", message: `Party created. Code ${party.code}` });
        await refreshQueue();
      } catch (err) {
        if (handleAuthFailure(err)) return;
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to create party" });
      } finally {
        setBusy((b) => ({ ...b, queue: false }));
      }
    },
    [handleAuthFailure, session, refreshQueue]
  );

  const joinParty = useCallback(
    async (code: string) => {
      if (!session) {
        setNotice({ type: "error", message: "Sign in first to join a party." });
        return;
      }
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) {
        setNotice({ type: "error", message: "Enter a party code." });
        return;
      }
      try {
        setBusy((b) => ({ ...b, queue: true }));
        const party = await api<PartyResponse>("/party/join", {
          method: "POST",
          body: JSON.stringify({ code: trimmed })
        });
        setNotice({ type: "success", message: `Joined party ${party.code}` });
        await refreshQueue();
      } catch (err) {
        if (handleAuthFailure(err)) return;
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to join party" });
      } finally {
        setBusy((b) => ({ ...b, queue: false }));
      }
    },
    [handleAuthFailure, session, refreshQueue]
  );

  const leaveParty = useCallback(
    async () => {
      if (!session) {
        setNotice({ type: "error", message: "Sign in first to leave a party." });
        return;
      }
      try {
        setBusy((b) => ({ ...b, queue: true }));
        await api("/party/leave", {
          method: "POST"
        });
        setNotice({ type: "success", message: "Left party." });
        await refreshQueue();
      } catch (err) {
        if (handleAuthFailure(err)) return;
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to leave party" });
      } finally {
        setBusy((b) => ({ ...b, queue: false }));
      }
    },
    [handleAuthFailure, session, refreshQueue]
  );

  const setPartyReady = useCallback(
    async (ready: boolean) => {
      if (!session) {
        setNotice({ type: "error", message: "Sign in first to ready up." });
        return;
      }
      try {
        setBusy((b) => ({ ...b, queue: true }));
        await api("/party/ready", {
          method: "POST",
          body: JSON.stringify({ ready })
        });
        await refreshQueue();
      } catch (err) {
        if (handleAuthFailure(err)) return;
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to update ready state" });
      } finally {
        setBusy((b) => ({ ...b, queue: false }));
      }
    },
    [handleAuthFailure, session, refreshQueue]
  );

  const leaveQueue = useCallback(
    async () => {
      if (!session) {
        setNotice({ type: "error", message: "Sign in first to leave queues." });
        return;
      }
      try {
        setBusy((b) => ({ ...b, queue: true }));
        const res = await api<{ ok: boolean; cancelledTickets: string[] }>("/queues/leave", {
          method: "POST"
        });
        setNotice({ type: "success", message: `Left queue. Cancelled tickets: ${res.cancelledTickets.join(", ") || "none"}` });
        setQueue(null);
        setMatch(null);
        if (joinRetryRef.current) {
          clearTimeout(joinRetryRef.current);
          joinRetryRef.current = null;
        }
        pendingJoinRef.current = null;
        await refreshQueue();
      } catch (err) {
        if (handleAuthFailure(err)) return;
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to leave queue" });
      } finally {
        setBusy((b) => ({ ...b, queue: false }));
      }
    },
    [handleAuthFailure, session, refreshQueue]
  );

  const clearNotice = useCallback(() => setNotice(null), []);
  const notify = useCallback((next: NonNullable<Notice>) => setNotice(next), []);

  const value = useMemo(
    () => ({
      session,
      user,
      queue,
      match,
      notice,
      busy,
      authenticate,
      signOut,
      joinQueue,
      leaveQueue,
      refreshQueue,
      createParty,
      joinParty,
      leaveParty,
      setPartyReady,
      clearNotice,
      notify
    }),
    [session, user, queue, match, notice, busy, authenticate, signOut, joinQueue, leaveQueue, refreshQueue, createParty, joinParty, leaveParty, setPartyReady, clearNotice, notify]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
