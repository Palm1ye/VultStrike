"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "./language-provider";

type Props = {
  open: boolean;
  onClose: () => void;
  command: string | null;
};

export function Cs2JoinModal({ open, onClose, command }: Props) {
  const { t } = useLanguage();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const handleCopy = useCallback(async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1500);
    }
  }, [command]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("joinConsole.title")}
      onClick={onClose}
    >
      <div className="glass-panel w-full max-w-xl p-5 md:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-400">{t("joinConsole.title")}</p>
            <p className="mt-2 text-sm text-zinc-400">{t("joinConsole.subtitle")}</p>
          </div>
          <button className="btn-ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t("joinConsole.commandLabel")}</p>
            <button
              className="px-3 py-2 rounded-full border border-white/20 text-white text-xs hover:border-brand disabled:opacity-60"
              type="button"
              onClick={handleCopy}
              disabled={!command}
            >
              {copyState === "copied"
                ? t("joinConsole.copied")
                : copyState === "error"
                  ? t("joinConsole.copyFailed")
                  : t("joinConsole.copy")}
            </button>
          </div>
          <pre className="overflow-auto rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-white">
            <code className="font-mono">{command ?? "Server is preparing..."}</code>
          </pre>
        </div>

        <ol className="list-decimal list-inside space-y-2 text-sm text-zinc-300">
          <li>{t("joinConsole.step1")}</li>
          <li>{t("joinConsole.step2")}</li>
          <li>{t("joinConsole.step3")}</li>
          <li>{t("joinConsole.step4")}</li>
        </ol>

        <p className="text-xs text-zinc-500">{t("joinConsole.note")}</p>
      </div>
    </div>
  );
}

