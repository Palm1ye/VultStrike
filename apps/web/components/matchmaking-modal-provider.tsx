"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MatchmakingConsole } from "@/components/matchmaking-console";
import { MatchFoundPopup } from "@/components/match-found-popup";

type MatchmakingModalContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const MatchmakingModalContext = createContext<MatchmakingModalContextValue | null>(null);

export function MatchmakingModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-matchmaking", handler);
    return () => window.removeEventListener("open-matchmaking", handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, isOpen]);

  const value = useMemo<MatchmakingModalContextValue>(() => ({ isOpen, open, close }), [close, isOpen, open]);

  return (
    <MatchmakingModalContext.Provider value={value}>
      {children}
      <MatchFoundPopup />

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Matchmaking"
        >
          <div
            className="glass-panel w-full max-w-4xl p-4 md:p-6 space-y-4 max-h-[85vh] overflow-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Matchmaking</h2>
              <button className="btn-ghost" type="button" onClick={close}>
                Close
              </button>
            </div>
            <MatchmakingConsole />
          </div>
        </div>
      ) : null}
    </MatchmakingModalContext.Provider>
  );
}

export function useMatchmakingModal() {
  const ctx = useContext(MatchmakingModalContext);
  if (!ctx) {
    throw new Error("useMatchmakingModal must be used within MatchmakingModalProvider");
  }
  return ctx;
}
