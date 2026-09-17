"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LanguageToggle } from "./language-toggle";
import { useLanguage } from "./language-provider";
import { useMatchmakingModal } from "./matchmaking-modal-provider";
import { useAppState } from "./app-state-provider";

const DISCORD_INVITE_URL = "https://discord.gg/bYCgf36Hkf";
const DISCORD_MODAL_SEEN_KEY = "vultstrike_discord_modal_seen_v1";

export function SiteHeader() {
  const { t } = useLanguage();
  const { open } = useMatchmakingModal();
  const { user, authenticate, signOut } = useAppState();
  const [discordModalOpen, setDiscordModalOpen] = useState(false);
  const [inviteCopyState, setInviteCopyState] = useState<"idle" | "copied" | "error">("idle");

  const closeDiscordModal = useCallback((remember = true) => {
    setDiscordModalOpen(false);
    if (remember) {
      try {
        window.localStorage.setItem(DISCORD_MODAL_SEEN_KEY, "1");
      } catch {
        // ignore storage failures
      }
    }
  }, []);

  const copyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(DISCORD_INVITE_URL);
      setInviteCopyState("copied");
    } catch {
      setInviteCopyState("error");
    } finally {
      window.setTimeout(() => setInviteCopyState("idle"), 1500);
    }
  }, []);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(DISCORD_MODAL_SEEN_KEY);
      if (seen === "1") return;
    } catch {
      // ignore storage failures
    }

    const timer = window.setTimeout(() => {
      setDiscordModalOpen(true);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!discordModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDiscordModal(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDiscordModal, discordModalOpen]);

  return (
    <>
      <header className="relative z-20 max-w-7xl mx-auto px-6 pt-6 pb-4 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand to-[#ff5f1f] flex items-center justify-center font-black text-black">
            VS
          </div>
          <div className="hidden sm:block">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">VultStrike</p>
            <p className="text-sm text-white font-medium">Competitive CS2 hub</p>
          </div>
        </Link>

        {/* Center nav */}
        <nav className="hidden lg:flex items-center gap-0.5 text-sm text-zinc-400 mx-auto">
          <Link className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 hover:text-white transition" href="/community">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Community
          </Link>
          <Link className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 hover:text-white transition" href="/rewards">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>
            Rewards
          </Link>
          <Link className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 hover:text-white transition" href="/operations">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            Operations
          </Link>
          <Link className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 hover:text-white transition" href="/profile">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            Profile
          </Link>
          <Link className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 hover:text-white transition" href="/events">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            Events
          </Link>
        </nav>

        {/* Right side actions */}
        <div className="relative flex items-center gap-2 ml-auto">
          {/* Discord */}
          <a
            className="flex items-center justify-center h-9 w-9 rounded-full border border-indigo-300/30 hover:border-indigo-200 bg-[#5865F2]/15 text-white hover:bg-[#5865F2]/25 transition shrink-0"
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={t("discord.buttonLabel")}
            title={t("discord.buttonLabel")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M13.545 2.907A13.227 13.227 0 0 0 10.227 1.7a.061.061 0 0 0-.065.03c-.143.251-.302.579-.413.84a12.19 12.19 0 0 0-3.498 0 8.114 8.114 0 0 0-.419-.84.061.061 0 0 0-.064-.03 13.14 13.14 0 0 0-3.32 1.207.055.055 0 0 0-.024.02C.533 5.683-.32 8.372.099 11.028a.064.064 0 0 0 .024.044 13.305 13.305 0 0 0 3.995 2.03.061.061 0 0 0 .066-.022c.308-.423.582-.87.818-1.342a.06.06 0 0 0-.032-.082 8.633 8.633 0 0 1-1.248-.595.06.06 0 0 1-.006-.099c.084-.063.168-.129.248-.195a.06.06 0 0 1 .062-.008c2.619 1.195 5.458 1.195 8.046 0a.06.06 0 0 1 .063.007c.08.067.164.133.248.196a.06.06 0 0 1-.006.1 8.31 8.31 0 0 1-1.249.594.06.06 0 0 0-.031.083c.24.472.514.919.817 1.341a.06.06 0 0 0 .066.022 13.217 13.217 0 0 0 4.001-2.03.06.06 0 0 0 .024-.043c.5-3.07-.838-5.735-2.322-8.1a.049.049 0 0 0-.024-.02zM5.33 9.388c-.79 0-1.438-.724-1.438-1.612 0-.888.633-1.613 1.438-1.613.813 0 1.45.731 1.438 1.613 0 .888-.633 1.612-1.438 1.612zm5.34 0c-.79 0-1.438-.724-1.438-1.612 0-.888.633-1.613 1.438-1.613.813 0 1.45.731 1.438 1.613 0 .888-.626 1.612-1.438 1.612z" />
            </svg>
          </a>

          {/* Language dropdown */}
          <LanguageToggle />

          {/* Auth area */}
          {user ? (
            <>
              {/* User chip */}
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-3 py-1 shrink-0 max-w-[160px]">
                <div className="h-7 w-7 rounded-full overflow-hidden bg-white/10 border border-white/10 flex items-center justify-center text-[10px] text-zinc-400 shrink-0">
                  {user.steamAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.steamAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (user.steamDisplayName ?? user.displayName ?? user.handle ?? "?").slice(0, 2).toUpperCase()
                  )}
                </div>
                <span className="text-sm text-white truncate leading-none">
                  {user.steamDisplayName ?? user.displayName ?? user.handle}
                </span>
              </div>
              <button
                className="hidden sm:block rounded-full border border-white/10 text-zinc-400 text-xs font-medium px-3 py-2 hover:border-white/25 hover:text-white transition shrink-0"
                type="button"
                onClick={() => signOut()}
              >
                Sign Out
              </button>
            </>
          ) : (
            <button
              className="hidden sm:flex items-center gap-2 rounded-full border border-white/15 bg-white/5 text-white text-sm font-semibold px-4 py-2 hover:border-brand hover:bg-brand/10 transition shrink-0"
              type="button"
              onClick={() => void authenticate()}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
              </svg>
              Sign In with Steam
            </button>
          )}

          {/* Matchmaking CTA */}
          <button
            className="flex items-center gap-2 rounded-full bg-brand text-black text-sm font-semibold px-4 py-2 shadow-[0_8px_24px_rgba(255,115,29,0.30)] hover:shadow-[0_8px_32px_rgba(255,115,29,0.45)] transition shrink-0"
            type="button"
            onClick={() => {
              if (user) {
                open();
                window.dispatchEvent(new Event("open-matchmaking"));
              } else {
                void authenticate();
              }
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            Matchmaking
          </button>
        </div>
      </header>

      {discordModalOpen && typeof document !== "undefined" ? createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("discord.modal.title")}
          onClick={() => closeDiscordModal(true)}
        >
          <div
            className="glass-panel w-full max-w-2xl p-6 md:p-8 relative overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#5865F2]/20 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-sky-300/10 blur-3xl pointer-events-none" />

            <div className="relative space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-indigo-200/80">{t("discord.modal.badge")}</p>
                  <h2 className="mt-2 text-2xl md:text-3xl font-semibold text-white">{t("discord.modal.title")}</h2>
                </div>
                <button className="btn-ghost" type="button" onClick={() => closeDiscordModal(true)}>
                  {t("discord.modal.close")}
                </button>
              </div>

              <p className="text-zinc-300">{t("discord.modal.body")}</p>

              <div className="grid gap-2 text-sm text-zinc-200">
                <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">{t("discord.modal.point1")}</div>
                <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">{t("discord.modal.point2")}</div>
                <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">{t("discord.modal.point3")}</div>
              </div>

              <div className="flex flex-wrap gap-3">
                <a
                  className="rounded-full bg-[#5865F2] text-white text-sm font-semibold px-4 py-2 shadow-[0_12px_30px_rgba(88,101,242,0.35)] hover:bg-[#6f79f5] transition"
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => closeDiscordModal(true)}
                >
                  {t("discord.modal.join")}
                </a>
                <button
                  className="rounded-full border border-white/20 text-white text-sm font-semibold px-4 py-2 hover:border-white/40 transition"
                  type="button"
                  onClick={() => void copyInvite()}
                >
                  {inviteCopyState === "copied"
                    ? t("discord.modal.copied")
                    : inviteCopyState === "error"
                      ? t("discord.modal.copyFailed")
                      : t("discord.modal.copy")}
                </button>
                <button
                  className="rounded-full border border-white/10 text-zinc-300 text-sm font-semibold px-4 py-2 hover:border-white/30 hover:text-white transition"
                  type="button"
                  onClick={() => closeDiscordModal(true)}
                >
                  {t("discord.modal.later")}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
