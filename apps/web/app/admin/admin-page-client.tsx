"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppState } from "@/components/app-state-provider";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();
const SESSION_TOKEN_KEY = "vultstrike_session_token";
type CompatibilityState = "compatible" | "outdated" | "checking" | "unknown";

type Match = {
  id: string;
  lobbyCode: string;
  map: string;
  mode: string;
  status: string;
  scoreAlpha: number;
  scoreBravo: number;
  currentRound: number;
  createdAt: string;
};

type BanHistoryEntry = {
  id: number;
  action: string;
  reason: string | null;
  banUntil: string | null;
  createdAt: string | null;
  user: { id: string; handle: string; displayName?: string | null };
  admin: { id: string; handle: string; displayName?: string | null } | null;
};

type BanPayload = {
  userId?: string;
  handle?: string;
  reason?: string;
  until?: string;
  durationMinutes?: number;
  durationHours?: number;
  durationDays?: number;
};

type MatchReport = {
  id: number;
  matchId: string;
  reason: string;
  details: string | null;
  reportedHandle: string | null;
  reportedUserId: string | null;
  createdAt: string | null;
  reporter: { id: string; handle: string; displayName?: string | null };
  match: { id: string; map: string | null; mode: string | null; status: string | null; lobbyCode: string | null };
};

const formatDurationSeconds = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

export default function AdminPageClient() {
  const { user } = useAppState();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [manualMatchId, setManualMatchId] = useState("");
  const [banTarget, setBanTarget] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banMinutes, setBanMinutes] = useState("");
  const [banHours, setBanHours] = useState("");
  const [banDays, setBanDays] = useState("");
  const [banUntil, setBanUntil] = useState("");
  const [banHistory, setBanHistory] = useState<BanHistoryEntry[]>([]);
  const [banLoading, setBanLoading] = useState(false);
  const [reports, setReports] = useState<MatchReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [cs2Update, setCs2Update] = useState<{
    running: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    success: boolean | null;
    output: string | null;
    buildId: string | null;
    installedBuildId: string | null;
    hostCs2Dir: string;
    steamLibraryDir: string | null;
    progressPercent: number | null;
    step: string;
    latestBuildId: string | null;
    compatibleWithLatest: boolean | null;
    compatibilityState: CompatibilityState;
    compatibilityCheckedAt: string | null;
    errorSummary: string | null;
  } | null>(null);
  const [cs2UpdateLoading, setCs2UpdateLoading] = useState(false);

  // Load matches on mount and set up polling
  useEffect(() => {
    if (user && user.role === "ADMIN") {
      loadMatches();
      loadBanHistory();
      loadReports();
      loadCs2UpdateStatus();

      // Poll for updates every 10 seconds
      const interval = setInterval(() => {
        loadMatches();
        loadBanHistory();
        loadReports();
        loadCs2UpdateStatus();
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [user]);

  // Server-side guard handles redirect. Keep client light here.

  const loadMatches = async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/matches/admin/list-open`, {
        method: "POST",
        credentials: "include",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const data = await res.json();
      const matches = data.matches || [];
      setMatches(matches);
      setMessage({ type: "success", text: `${matches.length} açık maç bulundu` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Maçları yüklerken hata oluştu" });
    } finally {
      setLoading(false);
    }
  };

  const finishAll = async () => {
    if (!confirm("Tüm açık maçları kapatmak istediğine emin misin?")) return;
    
    setLoading(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/matches/admin/finish-all`, {
        method: "POST",
        credentials: "include",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: "success", text: data.message });
        setMatches([]);
      } else {
        setMessage({ type: "error", text: data.error });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Maçları kapatırken hata oluştu" });
    } finally {
      setLoading(false);
    }
  };

  const finishMatch = async (matchId: string, winner?: "ALPHA" | "BRAVO" | "DRAW") => {
    setFinishingId(matchId);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/matches/admin/finish/${matchId}`, {
        method: "POST",
        credentials: "include",
        headers: { 
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ winner: winner || undefined })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const data = await res.json();
      if (data.ok) {
        setMatches(prev => prev.filter(m => m.id !== matchId));
        setMessage({ type: "success", text: `Maç kapatıldı: ${data.winner}` });
      } else {
        setMessage({ type: "error", text: data.error });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Maçı kapatırken hata oluştu" });
    } finally {
      setFinishingId(null);
    }
  };

  const parseNumber = (value: string) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
  };

  const loadBanHistory = async () => {
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/account/admin/ban-history?limit=50`, {
        credentials: "include",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) return;
      const data = await res.json();
      setBanHistory(Array.isArray(data) ? data : data?.logs ?? []);
    } catch {
      // ignore
    }
  };

  const loadReports = async () => {
    setReportsLoading(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/matches/admin/reports?limit=50`, {
        credentials: "include",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        setReports([]);
        return;
      }
      const data = await res.json();
      setReports(Array.isArray(data) ? data : data?.reports ?? []);
    } catch {
      setReports([]);
    } finally {
      setReportsLoading(false);
    }
  };

  const loadCs2UpdateStatus = async () => {
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/status/cs2-update`, {
        credentials: "include",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) return;
      setCs2Update(await res.json());
    } catch {
      // ignore
    }
  };

  const startCs2Update = async () => {
    if (!confirm("CS2 sunucusu güncellenecek. Aktif maç yoksa devam et.")) return;
    setCs2UpdateLoading(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/status/cs2-update/start`, {
        method: "POST",
        credentials: "include",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (res.status === 409) {
        setMessage({ type: "error", text: "Güncelleme zaten devam ediyor." });
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      setMessage({ type: "success", text: "CS2 güncellemesi başlatıldı." });
      await loadCs2UpdateStatus();
      // Start polling more frequently while update is running
      const poll = setInterval(async () => {
        try {
          const latestToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
          const latestRes = await fetch(`${API_BASE}/status/cs2-update`, {
            credentials: "include",
            headers: { ...(latestToken ? { Authorization: `Bearer ${latestToken}` } : {}) }
          });
          if (!latestRes.ok) return;
          const latest = await latestRes.json();
          setCs2Update(latest);
          if (!latest?.running) clearInterval(poll);
        } catch {
          // ignore
        }
      }, 3000);
      setTimeout(() => clearInterval(poll), 30 * 60 * 1000); // max 30 min
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Güncelleme başlatılamadı" });
    } finally {
      setCs2UpdateLoading(false);
    }
  };

  const updateDurationSeconds = cs2Update?.startedAt
    ? Math.max(
        0,
        Math.round(
          ((cs2Update.finishedAt ? new Date(cs2Update.finishedAt).getTime() : Date.now()) - new Date(cs2Update.startedAt).getTime()) / 1000
        )
      )
    : null;
  const compatibilityLabel =
    cs2Update?.compatibilityState === "compatible"
      ? "Sunucu build'i güncel CS2 ile uyumlu"
      : cs2Update?.compatibilityState === "outdated"
        ? "Sunucu build'i güncel CS2'nin gerisinde"
        : cs2Update?.compatibilityState === "checking"
          ? "Güncel CS2 build'i kontrol ediliyor"
          : "Uyumluluk bilgisi alınamadı";

  const banUser = async () => {
    if (!banTarget.trim()) {
      setMessage({ type: "error", text: "Ban için kullanıcı ID veya handle girin." });
      return;
    }
    setBanLoading(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const isUuid = /^[0-9a-f-]{36}$/i.test(banTarget.trim());
      const payload: BanPayload = isUuid ? { userId: banTarget.trim() } : { handle: banTarget.trim() };
      if (banReason.trim()) payload.reason = banReason.trim();
      if (banUntil.trim()) payload.until = banUntil.trim();
      const minutes = parseNumber(banMinutes);
      const hours = parseNumber(banHours);
      const days = parseNumber(banDays);
      if (!payload.until && (minutes || hours || days)) {
        if (minutes) payload.durationMinutes = minutes;
        if (hours) payload.durationHours = hours;
        if (days) payload.durationDays = days;
      }

      const res = await fetch(`${API_BASE}/account/admin/ban`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? "Ban işlemi başarısız");
      }
      setMessage({ type: "success", text: `Ban uygulandı: ${data.userId}` });
      setBanReason("");
      setBanMinutes("");
      setBanHours("");
      setBanDays("");
      setBanUntil("");
      await loadBanHistory();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Ban işlemi başarısız" });
    } finally {
      setBanLoading(false);
    }
  };

  const unbanUser = async () => {
    if (!banTarget.trim()) {
      setMessage({ type: "error", text: "Unban için kullanıcı ID veya handle girin." });
      return;
    }
    setBanLoading(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const isUuid = /^[0-9a-f-]{36}$/i.test(banTarget.trim());
      const payload = isUuid ? { userId: banTarget.trim() } : { handle: banTarget.trim() };
      const res = await fetch(`${API_BASE}/account/admin/unban`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? "Unban işlemi başarısız");
      }
      setMessage({ type: "success", text: `Unban uygulandı: ${data.userId}` });
      await loadBanHistory();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Unban işlemi başarısız" });
    } finally {
      setBanLoading(false);
    }
  };

  const displayName = user?.displayName || user?.handle || "Admin";
  const trimmedManualMatchId = manualMatchId.trim();

  return (
    <main className="max-w-6xl mx-auto py-12 px-6 space-y-8">
      <header>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-brand mb-4">
          <span>←</span> Ana Sayfa
        </Link>
        <h1 className="text-4xl font-semibold">Admin Dashboard</h1>
        <p className="text-zinc-400 mt-2">Hoş geldin, {displayName}</p>
      </header>

      {message && (
        <div className={`p-4 rounded-xl border ${
          message.type === "success" 
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-rose-500/30 bg-rose-500/10 text-rose-300"
        }`}>
          {message.text}
        </div>
      )}

      <div className="glass-panel p-6 space-y-4">
        <h2 className="text-2xl font-semibold">Maç Yönetimi</h2>
        
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={loadMatches}
            disabled={loading}
            className="px-4 py-2 bg-brand hover:bg-brand/90 disabled:bg-brand/50 text-black font-semibold rounded-lg transition-colors"
          >
            {loading ? "Yükleniyor..." : "Açık Maçları Yükle"}
          </button>
          
          {matches.length > 0 && (
            <button
              onClick={finishAll}
              disabled={loading}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-600/50 text-white font-semibold rounded-lg transition-colors"
            >
              Tüm Maçları Kapat ({matches.length})
            </button>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <p className="text-sm text-zinc-400">Maç ID ile kapat</p>
          <div className="flex flex-col gap-3">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="Match ID (ör: 5e906c6a-41fe-410d-ac11-dfe61c1e9575)"
              value={manualMatchId}
              onChange={(e) => setManualMatchId(e.target.value)}
            />
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => trimmedManualMatchId && finishMatch(trimmedManualMatchId)}
                disabled={!trimmedManualMatchId || finishingId === trimmedManualMatchId}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white text-sm font-semibold rounded transition-colors"
              >
                Kapat (Otomatik)
              </button>
              <button
                onClick={() => trimmedManualMatchId && finishMatch(trimmedManualMatchId, "ALPHA")}
                disabled={!trimmedManualMatchId || finishingId === trimmedManualMatchId}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-600/50 text-white text-sm font-semibold rounded transition-colors"
              >
                ALPHA Kazansın
              </button>
              <button
                onClick={() => trimmedManualMatchId && finishMatch(trimmedManualMatchId, "BRAVO")}
                disabled={!trimmedManualMatchId || finishingId === trimmedManualMatchId}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-600/50 text-white text-sm font-semibold rounded transition-colors"
              >
                BRAVO Kazansın
              </button>
              <button
                onClick={() => trimmedManualMatchId && finishMatch(trimmedManualMatchId, "DRAW")}
                disabled={!trimmedManualMatchId || finishingId === trimmedManualMatchId}
                className="px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 disabled:bg-zinc-600/50 text-white text-sm font-semibold rounded transition-colors"
              >
                Berabere
              </button>
            </div>
          </div>
        </div>

        {matches.length === 0 ? (
          <div className="text-center py-8 text-zinc-400">
            <p>Açık maç yok veya henüz yüklemedim.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {matches.map((match) => (
              <div key={match.id} className="border border-white/10 rounded-lg p-4 bg-white/5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-semibold">{match.map} • {match.mode}</p>
                    <p className="text-sm text-zinc-400">ID: {match.id.slice(0, 8)}... | Kod: {match.lobbyCode}</p>
                    <p className="text-sm text-zinc-500">
                      Oluş: {new Date(match.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">
                      <span className="text-sky-400">{match.scoreAlpha}</span>
                      <span className="text-zinc-400 mx-2">:</span>
                      <span className="text-amber-400">{match.scoreBravo}</span>
                    </div>
                    <p className="text-xs text-zinc-400">Round {match.currentRound}</p>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => finishMatch(match.id, "ALPHA")}
                    disabled={finishingId === match.id}
                    className="flex-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-600/50 text-white text-sm font-semibold rounded transition-colors"
                  >
                    ALPHA Kazansın
                  </button>
                  <button
                    onClick={() => finishMatch(match.id, "BRAVO")}
                    disabled={finishingId === match.id}
                    className="flex-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-600/50 text-white text-sm font-semibold rounded transition-colors"
                  >
                    BRAVO Kazansın
                  </button>
                  <button
                    onClick={() => finishMatch(match.id, "DRAW")}
                    disabled={finishingId === match.id}
                    className="flex-1 px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 disabled:bg-zinc-600/50 text-white text-sm font-semibold rounded transition-colors"
                  >
                    Berabere
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel p-6 space-y-4">
        <h2 className="text-2xl font-semibold">Kullanıcı Yönetimi</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <p className="text-sm text-zinc-400">Ban / Unban</p>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="User ID veya handle"
              value={banTarget}
              onChange={(e) => setBanTarget(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="Sebep (opsiyonel)"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                placeholder="Dakika"
                value={banMinutes}
                onChange={(e) => setBanMinutes(e.target.value)}
              />
              <input
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                placeholder="Saat"
                value={banHours}
                onChange={(e) => setBanHours(e.target.value)}
              />
              <input
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                placeholder="Gün"
                value={banDays}
                onChange={(e) => setBanDays(e.target.value)}
              />
            </div>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="Bitiş tarihi (YYYY-MM-DD veya ISO, opsiyonel)"
              value={banUntil}
              onChange={(e) => setBanUntil(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={banUser}
                disabled={banLoading}
                className="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-600/50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Ban
              </button>
              <button
                onClick={unbanUser}
                disabled={banLoading}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Unban
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">Ban Geçmişi (son 50)</p>
              <button
                onClick={loadBanHistory}
                className="text-xs text-zinc-400 hover:text-white"
                type="button"
              >
                Yenile
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {banHistory.length === 0 ? (
                <p className="text-xs text-zinc-500">Kayıt bulunamadı.</p>
              ) : (
                banHistory.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-white">
                        {entry.action} • {entry.user.displayName || entry.user.handle}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "--"}
                      </p>
                    </div>
                    <p className="text-[10px] text-zinc-500">
                      Admin: {entry.admin?.displayName || entry.admin?.handle || "system"}
                    </p>
                    {entry.reason && (
                      <p className="text-[10px] text-zinc-400">Sebep: {entry.reason}</p>
                    )}
                    <p className="text-[10px] text-zinc-500">
                      Bitiş: {entry.banUntil ? new Date(entry.banUntil).toLocaleString() : "Süresiz"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Maç Raporları</h2>
          <button
            onClick={loadReports}
            className="text-xs text-zinc-400 hover:text-white"
            type="button"
          >
            Yenile
          </button>
        </div>
        {reportsLoading ? (
          <p className="text-sm text-zinc-400">Yükleniyor...</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-zinc-500">Henüz rapor yok.</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {reports.map((report) => (
              <div key={report.id} className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {report.reason}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Maç: {report.match.map ?? "Unknown"} • {report.match.mode ?? "?"} • {report.match.status ?? "?"}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Match ID: <span className="font-mono">{report.matchId.slice(0, 8)}...</span>
                    </p>
                  </div>
                  <div className="text-right text-xs text-zinc-500">
                    {report.createdAt ? new Date(report.createdAt).toLocaleString() : "--"}
                  </div>
                </div>
                <div className="text-xs text-zinc-400">
                  Reporter: {report.reporter.displayName || report.reporter.handle || report.reporter.id}
                </div>
                {report.reportedHandle && (
                  <div className="text-xs text-zinc-400">
                    Reported: {report.reportedHandle}
                  </div>
                )}
                {report.details && (
                  <div className="text-xs text-zinc-400">
                    Detay: {report.details}
                  </div>
                )}
                <div className="text-xs text-zinc-500">
                  <Link href={`/match/${report.matchId}`} className="hover:text-brand">Maçı aç</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel p-6 space-y-4">
        <h2 className="text-2xl font-semibold">Sistem İstatistikleri</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-center">
            <p className="text-xs text-zinc-400">Açık Maçlar</p>
            <p className="text-2xl font-bold text-brand mt-2">{matches.length}</p>
          </div>
          
          <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-center">
            <p className="text-xs text-zinc-400">Rol</p>
            <p className="text-2xl font-bold text-emerald-400 mt-2">{user?.role ?? "--"}</p>
          </div>
          
          <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-center">
            <p className="text-xs text-zinc-400">ID</p>
            <p className="text-sm font-mono text-zinc-300 mt-2">{user?.id ? `${user.id.slice(0, 8)}...` : "--"}</p>
          </div>
          
          <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-center">
            <p className="text-xs text-zinc-400">API</p>
            <p className="text-sm font-mono text-zinc-300 mt-2">{API_BASE}</p>
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 space-y-4">
        <h2 className="text-2xl font-semibold">CS2 Sunucu Güncellemesi</h2>

        <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm text-zinc-400">
                steamcmd ile CS2 dedicated server güncellemesi başlatır.
                Aktif maç yokken çalıştırın.
              </p>
              <div className="mt-2 space-y-1 text-xs text-zinc-500">
                {cs2Update?.installedBuildId && (
                  <p>Aktif host build ID: <span className="font-mono text-zinc-300">{cs2Update.installedBuildId}</span></p>
                )}
                {cs2Update?.latestBuildId && (
                  <p>Güncel public build ID: <span className="font-mono text-zinc-300">{cs2Update.latestBuildId}</span></p>
                )}
                {cs2Update?.buildId && cs2Update.buildId !== cs2Update.latestBuildId && (
                  <p>Son updater çıktısındaki build ID: <span className="font-mono text-zinc-300">{cs2Update.buildId}</span></p>
                )}
                {cs2Update?.hostCs2Dir && (
                  <p>Aktif CS2 yolu: <span className="font-mono text-zinc-300 break-all">{cs2Update.hostCs2Dir}</span></p>
                )}
                {cs2Update?.steamLibraryDir && (
                  <p>Steam library: <span className="font-mono text-zinc-300 break-all">{cs2Update.steamLibraryDir}</span></p>
                )}
                {cs2Update?.compatibilityCheckedAt && (
                  <p>Son uyumluluk kontrolü: <span className="text-zinc-300">{new Date(cs2Update.compatibilityCheckedAt).toLocaleString()}</span></p>
                )}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={loadCs2UpdateStatus}
                className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded border border-white/10"
                type="button"
              >
                Yenile
              </button>
              <button
                onClick={startCs2Update}
                disabled={cs2UpdateLoading || cs2Update?.running === true}
                className="px-4 py-2 bg-brand hover:bg-brand/90 disabled:bg-brand/40 text-black font-semibold rounded-lg transition-colors text-sm"
              >
                {cs2Update?.running ? "Güncelleniyor..." : "CS2 Güncelle"}
              </button>
            </div>
          </div>

          {cs2Update && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  cs2Update.running
                    ? "bg-yellow-400 animate-pulse"
                    : cs2Update.success === true
                    ? "bg-emerald-400"
                    : cs2Update.success === false
                    ? "bg-rose-400"
                    : "bg-zinc-500"
                }`} />
                <span className="text-zinc-300">
                  {cs2Update.running
                    ? `Güncelleme devam ediyor... (${cs2Update.step})`
                    : cs2Update.success === true
                    ? "Güncelleme başarılı"
                    : cs2Update.success === false
                    ? "Güncelleme başarısız"
                    : "Henüz güncelleme yapılmadı"}
                </span>
                {cs2Update.startedAt && (
                  <span className="text-zinc-500 text-xs">
                    {new Date(cs2Update.startedAt).toLocaleString()}
                    {updateDurationSeconds !== null && ` — ${formatDurationSeconds(updateDurationSeconds)}`}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                  <span>Aşama: <span className="text-zinc-200">{cs2Update.step}</span></span>
                  <span>
                    {typeof cs2Update.progressPercent === "number"
                      ? `${cs2Update.progressPercent}%`
                      : cs2Update.running
                        ? "Yüzde bilgisi bekleniyor"
                        : cs2Update.success === true
                          ? "100%"
                          : "—"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${cs2Update.success === false ? "bg-rose-400" : "bg-brand"}`}
                    style={{ width: `${cs2Update.success === true ? 100 : cs2Update.progressPercent ?? (cs2Update.running ? 12 : 0)}%` }}
                  />
                </div>
                <p className={`text-xs break-words ${cs2Update.compatibilityState === "compatible" ? "text-emerald-300" : cs2Update.compatibilityState === "outdated" ? "text-amber-300" : "text-zinc-400"}`}>
                  {compatibilityLabel}
                </p>
                {cs2Update.success === false && cs2Update.errorSummary && (
                  <p className="text-xs text-rose-300 break-words">Son hata: {cs2Update.errorSummary}</p>
                )}
              </div>

              {cs2Update.output && (
                <details className="group" open={cs2Update.running}>
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 select-none">
                    Canlı konsol çıktısı
                  </summary>
                  <pre className="mt-2 text-[11px] text-zinc-400 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all">
                    {cs2Update.output}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="glass-panel p-6 space-y-4">
        <h2 className="text-2xl font-semibold">Diğer Yönetim İşlemleri</h2>

        <div className="space-y-3">
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <h3 className="font-semibold mb-2">Veritabanı Kurtarma</h3>
            <p className="text-sm text-zinc-400 mb-3">
              Şu anda bu işlem manuel olarak yapılmalıdır. Yöneticiye başvur.
            </p>
            <button disabled className="px-4 py-2 bg-zinc-600 text-white font-semibold rounded opacity-50 cursor-not-allowed">
              Yakında Eklenecek
            </button>
          </div>

          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <h3 className="font-semibold mb-2">Sistem Günlükleri</h3>
            <p className="text-sm text-zinc-400 mb-3">
              API ve sistem günlüklerini görüntüle
            </p>
            <button disabled className="px-4 py-2 bg-zinc-600 text-white font-semibold rounded opacity-50 cursor-not-allowed">
              Yakında Eklenecek
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
