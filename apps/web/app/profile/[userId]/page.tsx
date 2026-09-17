"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAppState } from "@/components/app-state-provider";
import { useLanguage } from "@/components/language-provider";
import { getApiBase } from "@/lib/api-base";
import { getRankForMmr } from "@/lib/ranks";

const API_BASE = getApiBase();

const themes = [
  { id: "default", gradient: "from-orange-500/20 via-purple-500/10 to-blue-500/20" },
  { id: "cyber", gradient: "from-pink-500/20 via-cyan-500/10 to-purple-500/20" },
  { id: "matrix", gradient: "from-green-500/20 via-emerald-500/10 to-teal-500/20" },
  { id: "sunset", gradient: "from-red-500/20 via-orange-500/10 to-yellow-500/20" },
  { id: "ocean", gradient: "from-blue-500/20 via-cyan-500/10 to-indigo-500/20" },
];

const cardBorders = [
  { id: "default", class: "border-white/5" },
  { id: "glow", class: "border-brand/30 shadow-[0_0_20px_rgba(255,157,0,0.15)]" },
  { id: "neon", class: "border-cyan-400/40 shadow-[0_0_15px_rgba(34,211,238,0.2)]" },
  { id: "purple", class: "border-purple-400/40 shadow-[0_0_15px_rgba(168,85,247,0.2)]" },
];

const avatars = [
  { id: "default", emoji: "🎮" },
  { id: "ninja", emoji: "🥷" },
  { id: "ghost", emoji: "👻" },
  { id: "skull", emoji: "💀" },
  { id: "crown", emoji: "👑" },
  { id: "fire", emoji: "🔥" },
  { id: "lightning", emoji: "⚡" },
  { id: "target", emoji: "🎯" },
];

const modes = ["1v1", "2v2", "3v3"] as const;

type ProfileVisibility = {
  isAuthenticated?: boolean;
  isSelf?: boolean;
  canViewCompetitiveDetails?: boolean;
};

type ProfileData = {
  id: string;
  handle?: string | null;
  displayName?: string | null;
  visibility?: ProfileVisibility | null;
  role?: string | null;
  trustScore?: number | null;
  steamId?: string | null;
  steamDisplayName?: string | null;
  steamAvatar?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banUntil?: string | null;
  mmr?: { "1v1"?: number | null; "2v2"?: number | null; "3v3"?: number | null } | null;
  placement?: {
    "1v1"?: { matches: number; completed: boolean } | null;
    "2v2"?: { matches: number; completed: boolean } | null;
    "3v3"?: { matches: number; completed: boolean } | null;
  } | null;
  lastMatch?: {
    id: string;
    map?: string | null;
    status?: string | null;
    mmrDelta?: number | null;
    completedAt?: string | null;
  } | null;
  recentMatches?: Array<{
    id: string;
    map?: string | null;
    status?: string | null;
    mmrDelta?: number | null;
    completedAt?: string | null;
  }> | null;
  customization?: { theme?: string; border?: string; avatar?: string; status?: string } | null;
  stats?: { wins: number; losses: number; draws?: number; matches?: number; winRate?: number | null } | null;
};

type SessionInfo = {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
};

type ProfileTab = "overview" | "identity" | "sessions" | "customize";

export default function ProfilePage() {
  const { t } = useLanguage();
  const { user, notice, signOut } = useAppState();
  const params = useParams();
  const requestedId = params.userId as string | undefined;

  const isOwnProfile = !requestedId || requestedId === "me" || requestedId === user?.id;
  const isPublicView = !isOwnProfile;

  const [profileUser, setProfileUser] = useState<ProfileData | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [savingCustomization, setSavingCustomization] = useState(false);
  const [customizationLoaded, setCustomizationLoaded] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState("default");
  const [selectedBorder, setSelectedBorder] = useState("default");
  const [selectedAvatar, setSelectedAvatar] = useState("default");
  const [customStatus, setCustomStatus] = useState("");
  const [originalTheme, setOriginalTheme] = useState("default");
  const [originalBorder, setOriginalBorder] = useState("default");
  const [originalAvatar, setOriginalAvatar] = useState("default");
  const [originalStatus, setOriginalStatus] = useState("");

  const activeProfile = isPublicView ? profileUser : user;
  const canViewCompetitiveDetails = isPublicView
    ? Boolean(profileUser?.visibility?.canViewCompetitiveDetails)
    : Boolean(user);

  const displayName = useMemo(
    () => activeProfile?.steamDisplayName ?? activeProfile?.displayName ?? activeProfile?.handle ?? t("profile.guest"),
    [activeProfile, t],
  );

  const mmr = activeProfile?.mmr ?? { "1v1": null, "2v2": null, "3v3": null };
  const stats = activeProfile?.stats ?? { wins: 0, losses: 0, winRate: null };
  const recentMatch = activeProfile?.lastMatch ?? activeProfile?.recentMatches?.[0] ?? null;

  const banInfo = useMemo(() => {
    if (!activeProfile?.banned) return null;

    const rawUntil = activeProfile.banUntil ? new Date(activeProfile.banUntil) : null;
    const hasExpiry = rawUntil && !Number.isNaN(rawUntil.getTime());
    if (hasExpiry && rawUntil.getTime() <= Date.now()) {
      return null;
    }

    return {
      reason: activeProfile.banReason ?? null,
      until: hasExpiry ? rawUntil : null,
    };
  }, [activeProfile]);

  const applyCustomization = useCallback((next?: { theme?: string; border?: string; avatar?: string; status?: string } | null) => {
    const theme = next?.theme ?? "default";
    const border = next?.border ?? "default";
    const avatar = next?.avatar ?? "default";
    const status = next?.status ?? "";

    setSelectedTheme(theme);
    setSelectedBorder(border);
    setSelectedAvatar(avatar);
    setCustomStatus(status);

    setOriginalTheme(theme);
    setOriginalBorder(border);
    setOriginalAvatar(avatar);
    setOriginalStatus(status);
  }, []);

  useEffect(() => {
    if (customizationLoaded) return;

    if (isPublicView) {
      if (!profileUser) return;
      applyCustomization(profileUser.customization);
      setCustomizationLoaded(true);
      return;
    }

    if (!user?.id) return;

    fetch(`${API_BASE}/account/${user.id}/customization`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => applyCustomization(data))
      .catch(() => applyCustomization(null))
      .finally(() => setCustomizationLoaded(true));
  }, [applyCustomization, customizationLoaded, isPublicView, profileUser, user?.id]);

  useEffect(() => {
    setCustomizationLoaded(false);
  }, [requestedId, user?.id]);

  const saveCustomization = useCallback(async () => {
    if (!user?.id || isPublicView) return;

    setSavingCustomization(true);
    try {
      await fetch(`${API_BASE}/account/${user.id}/customization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          theme: selectedTheme,
          border: selectedBorder,
          avatar: selectedAvatar,
          status: customStatus,
        }),
      });
    } catch {
      // Ignore save errors in UI, keep current draft for retry.
    } finally {
      setSavingCustomization(false);
    }
  }, [customStatus, isPublicView, selectedAvatar, selectedBorder, selectedTheme, user?.id]);

  const cancelCustomization = useCallback(() => {
    setSelectedTheme(originalTheme);
    setSelectedBorder(originalBorder);
    setSelectedAvatar(originalAvatar);
    setCustomStatus(originalStatus);
  }, [originalAvatar, originalBorder, originalStatus, originalTheme]);

  const hasUnsavedChanges = useMemo(
    () =>
      selectedTheme !== originalTheme
      || selectedBorder !== originalBorder
      || selectedAvatar !== originalAvatar
      || customStatus !== originalStatus,
    [customStatus, originalAvatar, originalBorder, originalStatus, originalTheme, selectedAvatar, selectedBorder, selectedTheme],
  );

  const handleSaveCustomization = useCallback(async () => {
    await saveCustomization();
    setOriginalTheme(selectedTheme);
    setOriginalBorder(selectedBorder);
    setOriginalAvatar(selectedAvatar);
    setOriginalStatus(customStatus);
  }, [customStatus, saveCustomization, selectedAvatar, selectedBorder, selectedTheme]);

  useEffect(() => {
    if (isOwnProfile) {
      setProfileUser(null);
      setProfileError(null);
      setLoadingProfile(false);
      return;
    }

    let active = true;
    setLoadingProfile(true);
    setProfileError(null);

    fetch(`${API_BASE}/account/${requestedId}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(t("profile.notFound"));
        return res.json();
      })
      .then((data: ProfileData) => {
        if (active) setProfileUser(data);
      })
      .catch((err) => {
        if (active) setProfileError(err instanceof Error ? err.message : t("profile.notFound"));
      })
      .finally(() => {
        if (active) setLoadingProfile(false);
      });

    return () => {
      active = false;
    };
  }, [isOwnProfile, requestedId, t]);

  const loadSessions = useCallback(async () => {
    if (!user?.id) return;

    setLoadingSessions(true);
    try {
      const res = await fetch(`${API_BASE}/account/${user.id}/sessions`, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as SessionInfo[];
        setSessions(
          data.map((session) => ({
            id: session.id,
            device: session.device,
            location: session.location,
            lastActive: session.lastActive,
            current: session.current,
          })),
        );
      } else {
        setSessions([]);
      }
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isPublicView && activeTab === "sessions") {
      void loadSessions();
    }
  }, [activeTab, isPublicView, loadSessions]);

  useEffect(() => {
    if (isPublicView && activeTab !== "overview") {
      setActiveTab("overview");
    }
  }, [activeTab, isPublicView]);

  const terminateSession = async (sessionId: string) => {
    if (!user?.id) return;

    try {
      const res = await fetch(`${API_BASE}/account/${user.id}/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      }
    } catch {
      // Ignore terminate errors and keep current session list.
    }
  };

  const roleLabel = t(`profile.role.${(activeProfile?.role ?? "USER").toLowerCase()}`);
  const tabs: Array<{ id: ProfileTab; label: string }> = isPublicView
    ? [{ id: "overview", label: t("profile.tab.overview") }]
    : [
        { id: "overview", label: t("profile.tab.overview") },
        { id: "identity", label: t("profile.tab.identity") },
        { id: "sessions", label: t("profile.tab.sessions") },
        { id: "customize", label: t("profile.tab.customize") },
      ];

  const currentTheme = themes.find((theme) => theme.id === selectedTheme) ?? themes[0];
  const currentBorder = cardBorders.find((border) => border.id === selectedBorder) ?? cardBorders[0];
  const currentAvatar = avatars.find((avatar) => avatar.id === selectedAvatar) ?? avatars[0];

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {isPublicView ? (
            <Link href="/profile/me" className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-brand mb-3">
              <span>←</span>
              {t("profile.backToYourProfile")}
            </Link>
          ) : null}
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            {isPublicView ? t("profile.publicLabel") : t("profile.label")}
          </p>
          <h1 className="mt-1 text-3xl md:text-4xl font-semibold text-white">{displayName}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {isPublicView ? t("profile.publicSubtitle") : t("profile.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!user ? (
            <button
              type="button"
              onClick={() => (window.location.href = `${API_BASE}/auth/steam`)}
              className="rounded-full bg-brand text-black text-sm font-semibold px-4 py-2"
            >
              {t("profile.signIn")}
            </button>
          ) : !isPublicView ? (
            <button
              type="button"
              onClick={signOut}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-200 hover:border-brand"
            >
              {t("profile.signOut")}
            </button>
          ) : null}
        </div>
      </header>

      {notice ? (
        <div className="glass-panel px-4 py-3 text-sm border border-white/10 text-zinc-200">
          {notice.message}
        </div>
      ) : null}

      {banInfo ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <p className="font-semibold">{t("profile.bannedTitle")}</p>
          <p className="mt-1 text-xs text-rose-200/90">
            {banInfo.reason ? t("profile.bannedReason", { reason: banInfo.reason }) : t("profile.bannedNoReason")}
          </p>
          <p className="text-xs text-rose-200/90">
            {banInfo.until
              ? t("profile.bannedUntil", { until: banInfo.until.toLocaleString() })
              : t("profile.bannedIndefinite")}
          </p>
        </div>
      ) : null}

      {loadingProfile ? (
        <div className="glass-panel p-10 text-center space-y-4">
          <div className="inline-block h-6 w-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          <p className="text-sm text-zinc-400">{t("profile.loading")}</p>
        </div>
      ) : profileError ? (
        <div className="glass-panel p-10 text-center space-y-4">
          <p className="text-2xl font-semibold text-white">{t("profile.notFound")}</p>
          <p className="text-sm text-zinc-400">{profileError}</p>
        </div>
      ) : !activeProfile ? (
        <div className="glass-panel p-10 text-center space-y-4">
          <p className="text-2xl font-semibold text-white">{t("profile.loginTitle")}</p>
          <p className="text-sm text-zinc-400">{t("profile.loginSubtitle")}</p>
          <button
            type="button"
            onClick={() => (window.location.href = `${API_BASE}/auth/steam`)}
            className="rounded-full bg-brand text-black text-sm font-semibold px-6 py-3"
          >
            {t("profile.signIn")}
          </button>
        </div>
      ) : (
        <>
          <div className="inline-flex flex-wrap items-center gap-2 rounded-full bg-white/5 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  activeTab === tab.id ? "bg-brand text-black" : "text-zinc-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
            <div className="space-y-6">
              <section className="glass-panel relative overflow-hidden p-6 sm:p-8">
                <div className={`absolute inset-0 bg-gradient-to-br ${currentTheme.gradient} opacity-35 pointer-events-none`} />
                <div className="absolute -top-24 right-0 h-56 w-56 rounded-full bg-brand/10 blur-3xl pointer-events-none" />

                <div className="relative grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                    <div className={`mx-auto h-24 w-24 shrink-0 rounded-3xl border-2 ${currentBorder.class} bg-black/25 p-1 sm:mx-0`}>
                      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[1rem] bg-white/10 text-4xl">
                        {activeProfile.steamAvatar ? (
                          <Image
                            src={activeProfile.steamAvatar}
                            alt={t("profile.avatarAlt")}
                            width={128}
                            height={128}
                            className="h-full w-full rounded-[1rem] object-cover"
                            unoptimized
                          />
                        ) : (
                          currentAvatar.emoji
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 text-center sm:text-left">
                      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                        <h2 className="text-2xl sm:text-3xl font-semibold text-white">{displayName}</h2>
                        <span className="pill-muted border border-white/10 bg-white/5">
                          {isPublicView ? t("profile.publicProfile") : t("profile.label")}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-zinc-500">@{activeProfile.handle ?? t("profile.guest")}</p>
                      {customStatus ? <p className="mt-3 text-sm italic text-brand">&ldquo;{customStatus}&rdquo;</p> : null}

                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                        <span className="pill-muted">{roleLabel}</span>
                        <span className="pill-muted">{t("account.trust")}: {activeProfile.trustScore ?? "--"}</span>
                        <span className="pill-muted">
                          {activeProfile.steamId && activeProfile.steamId !== "unlinked"
                            ? t("profile.identity.linked")
                            : t("profile.notLinked")}
                        </span>
                        <span className="pill-muted">
                          {canViewCompetitiveDetails ? t("profile.identity.connected") : t("account.mmrHidden")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-white/5 bg-black/25 p-4 text-center">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.stats.trustScore")}</p>
                      <p className="mt-2 text-2xl font-semibold text-brand">{activeProfile.trustScore ?? "--"}</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/25 p-4 text-center">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.stats.wins")}</p>
                      <p className="mt-2 text-2xl font-semibold text-emerald-300">{stats.wins ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/25 p-4 text-center">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.stats.losses")}</p>
                      <p className="mt-2 text-2xl font-semibold text-rose-300">{stats.losses ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/25 p-4 text-center">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.stats.winRate")}</p>
                      <p className="mt-2 text-2xl font-semibold text-zinc-200">
                        {stats.winRate === null || typeof stats.winRate === "undefined" ? "-" : `${stats.winRate}%`}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="glass-panel p-5 sm:p-6 space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-white">{t("profile.player")}</h3>
                    <span className="pill-muted">{canViewCompetitiveDetails ? t("profile.identity.connected") : t("account.mmrHidden")}</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {modes.map((mode) => {
                      const value = mmr[mode] ?? 0;
                      const placementData = activeProfile.placement?.[mode];
                      const isInPlacement = placementData
                        ? placementData.matches < 5 && !placementData.completed
                        : value <= 0;
                      const rank = getRankForMmr(value, isInPlacement);
                      const hasGlow = rank.glow !== "none";

                      return (
                        <div
                          key={mode}
                          className={`rounded-2xl border p-4 transition-all ${
                            canViewCompetitiveDetails
                              ? hasGlow
                                ? "border-purple-500/30 bg-purple-500/10 shadow-[0_0_22px_rgba(168,85,247,0.18)]"
                                : "border-white/10 bg-white/5 hover:border-white/20"
                              : "border-white/5 bg-white/5"
                          }`}
                        >
                          <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{mode}</p>

                          {canViewCompetitiveDetails ? (
                            <>
                              <p
                                className={`mt-2 text-3xl font-semibold ${hasGlow ? "bg-clip-text text-transparent" : "text-white"}`}
                                style={
                                  hasGlow
                                    ? {
                                        backgroundImage: "linear-gradient(90deg,#f5d0fe,#d8b4fe,#c4b5fd,#f5d0fe)",
                                        backgroundSize: "180% 100%",
                                      }
                                    : undefined
                                }
                              >
                                {value}
                              </p>
                              <p className={`mt-1 text-xs font-semibold ${rank.color}`}>{rank.label}</p>
                            </>
                          ) : (
                            <>
                              <p className="mt-2 text-xl font-semibold text-zinc-500">{t("account.mmrHidden")}</p>
                              <p className="mt-1 text-xs font-semibold text-zinc-500">{t("leaderboard.signIn")}</p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <aside className="space-y-6">
                  <div className="glass-panel p-5 sm:p-6 space-y-3">
                    <h3 className="text-lg font-semibold text-white">{t("profile.quick.title")}</h3>
                    <Link href="/community" className="btn-ghost w-full justify-between">
                      <span>{t("profile.quick.community")}</span>
                      <span className="text-zinc-500">›</span>
                    </Link>
                    <Link href="/match" className="btn-ghost w-full justify-between">
                      <span>{t("profile.quick.matches")}</span>
                      <span className="text-zinc-500">›</span>
                    </Link>
                    <Link href="/rewards" className="btn-ghost w-full justify-between">
                      <span>{t("profile.quick.rewards")}</span>
                      <span className="text-zinc-500">›</span>
                    </Link>
                  </div>

                  {!canViewCompetitiveDetails ? (
                    <div className="glass-panel border border-brand/20 bg-brand/10 p-5 sm:p-6">
                      <p className="text-xs uppercase tracking-[0.3em] text-brand/80">{t("account.mmrHidden")}</p>
                      <p className="mt-2 text-sm text-zinc-300">{t("profile.loginSubtitle")}</p>
                      <button
                        type="button"
                        onClick={() => (window.location.href = `${API_BASE}/auth/steam`)}
                        className="mt-4 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black"
                      >
                        {t("profile.signIn")}
                      </button>
                    </div>
                  ) : null}
                </aside>
              </section>

              <section className="glass-panel p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-white">{t("profile.recentMatch")}</h3>
                  <span className="pill-muted">{recentMatch ? t("profile.matchStatus") : t("profile.noRecent")}</span>
                </div>

                {recentMatch ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.matchMap")}</p>
                      <p className="mt-2 text-sm font-medium text-white">{recentMatch.map ?? t("profile.tbd")}</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.matchStatus")}</p>
                      <p className="mt-2 text-sm font-medium text-white">{recentMatch.status ?? t("profile.unknown")}</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.matchDelta")}</p>
                      {canViewCompetitiveDetails && typeof recentMatch.mmrDelta === "number" ? (
                        <p className={`mt-2 text-sm font-semibold ${recentMatch.mmrDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {recentMatch.mmrDelta >= 0 ? "+" : ""}
                          {recentMatch.mmrDelta} MMR
                        </p>
                      ) : (
                        <p className="mt-2 text-sm font-semibold text-zinc-500">{t("account.mmrHidden")}</p>
                      )}
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{t("profile.matchId")}</p>
                      <p className="mt-2 font-mono text-sm text-white">{recentMatch.id.slice(0, 8)}...</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-zinc-500">
                    {t("profile.noRecent")}
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {activeTab === "identity" && !isPublicView ? (
            <section className="glass-panel p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">{t("profile.identity.title")}</h3>
                <p className="text-sm text-zinc-400">{t("profile.identity.subtitle")}</p>
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/5 bg-white/5 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[#1b2838] text-white flex items-center justify-center font-semibold">S</div>
                    <div>
                      <p className="font-semibold">Steam</p>
                      <p className="text-xs text-zinc-500">
                        {activeProfile?.steamId && activeProfile.steamId !== "unlinked"
                          ? activeProfile.steamDisplayName ?? t("profile.identity.linked")
                          : t("profile.identity.notConnected")}
                      </p>
                    </div>
                  </div>
                  {activeProfile?.steamId && activeProfile.steamId !== "unlinked" ? (
                    <span className="pill">{t("profile.identity.connected")}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (window.location.href = `${API_BASE}/auth/steam`)}
                      className="rounded-full bg-brand text-black text-xs font-semibold px-4 py-2"
                    >
                      {t("profile.identity.connect")}
                    </button>
                  )}
                </div>

                <div className="rounded-2xl border border-white/5 bg-white/5 p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Discord</p>
                    <p className="text-xs text-zinc-500">{t("profile.comingSoon")}</p>
                  </div>
                  <span className="pill-muted">{t("profile.soon")}</span>
                </div>

                <div className="rounded-2xl border border-white/5 bg-white/5 p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Email</p>
                    <p className="text-xs text-zinc-500">{t("profile.comingSoon")}</p>
                  </div>
                  <span className="pill-muted">{t("profile.soon")}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                <h4 className="font-semibold mb-3">{t("profile.identity.details")}</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500">{t("profile.identity.userId")}</span>
                    <span className="font-mono text-zinc-300">{activeProfile?.id ?? "-"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500">{t("profile.identity.handle")}</span>
                    <span className="text-zinc-300">{activeProfile?.handle ?? t("profile.identity.notSet")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500">{t("profile.identity.displayName")}</span>
                    <span className="text-zinc-300">{activeProfile?.displayName ?? t("profile.identity.notSet")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500">{t("profile.status")}</span>
                    <span className="text-zinc-300">{roleLabel}</span>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "sessions" && !isPublicView ? (
            <section className="glass-panel p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">{t("profile.sessions.title")}</h3>
                <p className="text-sm text-zinc-400">{t("profile.sessions.subtitle")}</p>
              </div>

              {loadingSessions ? (
                <div className="text-center py-8">
                  <div className="inline-block h-6 w-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  <p className="mt-2 text-sm text-zinc-500">{t("profile.sessions.loading")}</p>
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-zinc-500">
                  {t("profile.sessions.empty")}
                </div>
              ) : (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 border ${
                        session.current ? "border-brand/30 bg-brand/10" : "border-white/5 bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-lg ${session.current ? "bg-brand/20" : "bg-white/10"}`}>
                          {session.device.includes("Windows") ? "W" : session.device.includes("macOS") ? "M" : "L"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold truncate">{session.device}</p>
                            {session.current ? (
                              <span className="text-[10px] rounded-full bg-brand px-2 py-0.5 font-bold text-black">
                                {t("profile.sessions.current")}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-zinc-500 truncate">{session.location} • {session.lastActive}</p>
                        </div>
                      </div>

                      {!session.current ? (
                        <button
                          type="button"
                          onClick={() => terminateSession(session.id)}
                          className="rounded-full border border-rose-500/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"
                        >
                          {t("profile.sessions.terminate")}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
                <strong>{t("profile.sessions.tipTitle")}</strong> {t("profile.sessions.tipBody")}
              </div>
            </section>
          ) : null}

          {activeTab === "customize" && !isPublicView ? (
            <section className="space-y-6">
              <div className="glass-panel p-6 space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold mb-1">{t("profile.customize.title")}</h3>
                    <p className="text-sm text-zinc-400">{t("profile.customize.subtitle")}</p>
                  </div>
                  {savingCustomization ? (
                    <span className="text-xs text-zinc-500 flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                      {t("profile.customize.saving")}
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-zinc-300">{t("profile.customize.theme")}</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {themes.map((theme) => (
                          <button
                            key={theme.id}
                            type="button"
                            onClick={() => setSelectedTheme(theme.id)}
                            className={`rounded-xl border p-3 text-left transition-all ${
                              selectedTheme === theme.id
                                ? "border-brand bg-brand/10"
                                : "border-white/10 bg-white/5 hover:border-white/20"
                            }`}
                          >
                            <div className={`mb-2 h-8 rounded-lg bg-gradient-to-br ${theme.gradient}`} />
                            <p className="text-sm font-medium">{t(`profile.theme.${theme.id}`)}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium text-zinc-300">{t("profile.customize.border")}</label>
                      <div className="grid grid-cols-2 gap-3">
                        {cardBorders.map((border) => (
                          <button
                            key={border.id}
                            type="button"
                            onClick={() => setSelectedBorder(border.id)}
                            className={`rounded-xl border p-3 text-left transition-all ${
                              selectedBorder === border.id
                                ? "border-brand bg-brand/10"
                                : "border-white/10 bg-white/5 hover:border-white/20"
                            }`}
                          >
                            <div className={`mb-2 h-8 rounded-lg border bg-white/10 ${border.class}`} />
                            <p className="text-sm font-medium">{t(`profile.border.${border.id}`)}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium text-zinc-300">{t("profile.customize.avatar")}</label>
                      <div className="flex flex-wrap gap-2">
                        {avatars.map((avatar) => (
                          <button
                            key={avatar.id}
                            type="button"
                            onClick={() => setSelectedAvatar(avatar.id)}
                            title={t(`profile.avatar.${avatar.id}`)}
                            className={`h-12 w-12 rounded-xl text-2xl transition-all ${
                              selectedAvatar === avatar.id
                                ? "bg-brand text-black ring-2 ring-brand ring-offset-2 ring-offset-black"
                                : "bg-white/10 hover:bg-white/20"
                            }`}
                          >
                            {avatar.emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium text-zinc-300">{t("profile.customize.status")}</label>
                      <input
                        type="text"
                        value={customStatus}
                        onChange={(event) => setCustomStatus(event.target.value)}
                        placeholder={t("profile.customize.placeholder")}
                        maxLength={64}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand focus:outline-none"
                      />
                      <p className="text-xs text-zinc-500">{t("profile.customize.count", { count: customStatus.length })}</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="glass-panel p-4">
                      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-zinc-500">{t("profile.customize.preview")}</p>
                      <div className={`rounded-xl border p-4 bg-gradient-to-br ${currentTheme.gradient} ${currentBorder.class}`}>
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-xl bg-black/30 flex items-center justify-center text-2xl">
                            {currentAvatar.emoji}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{displayName}</p>
                            {customStatus ? <p className="text-xs text-white/80">{customStatus}</p> : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="glass-panel p-4 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={cancelCustomization}
                        disabled={!hasUnsavedChanges || savingCustomization}
                        className={`rounded-full border px-5 py-2.5 text-sm font-medium transition-all ${
                          hasUnsavedChanges && !savingCustomization
                            ? "border-white/20 text-zinc-300 hover:border-white/40 hover:text-white"
                            : "cursor-not-allowed border-white/5 text-zinc-600"
                        }`}
                      >
                        {t("profile.customize.cancel")}
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveCustomization}
                        disabled={!hasUnsavedChanges || savingCustomization}
                        className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                          hasUnsavedChanges && !savingCustomization
                            ? "bg-brand text-black hover:bg-brand/90"
                            : "cursor-not-allowed bg-brand/30 text-black/50"
                        }`}
                      >
                        {savingCustomization ? t("profile.customize.saving") : t("profile.customize.save")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
