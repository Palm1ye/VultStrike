"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Locale } from "@/lib/translations";
import { useLanguage } from "./language-provider";

const FLAG_URL: Record<Locale, string> = {
  en: "https://flagcdn.com/us.svg",
  tr: "https://flagcdn.com/tr.svg",
  es: "https://flagcdn.com/es.svg",
  fr: "https://flagcdn.com/fr.svg",
  ru: "https://flagcdn.com/ru.svg",
  de: "https://flagcdn.com/de.svg",
};

function Flag({ locale }: { locale: Locale }) {
  return (
    <Image
      src={FLAG_URL[locale]}
      width={20}
      height={14}
      alt=""
      className="w-5 h-3.5 rounded-sm object-cover shrink-0"
      unoptimized
      aria-hidden="true"
    />
  );
}

const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "ru", label: "Русский" },
  { code: "de", label: "Deutsch" },
];

export function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = LOCALES.find((l) => l.code === lang) ?? LOCALES[0];

  const close = useCallback(() => setOpen(false), []);

  const handleOpen = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-200 hover:border-white/25 hover:text-white transition"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {<Flag locale={current.code} />}
        <span className="font-medium uppercase tracking-wide">{current.code}</span>
        <svg className={`w-3 h-3 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: dropdownStyle.top, right: dropdownStyle.right, zIndex: 9999 }}
          className="w-44 rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-sm shadow-xl overflow-hidden max-h-80 overflow-y-auto"
          role="listbox"
        >
          {LOCALES.map((locale) => (
            <button
              key={locale.code}
              type="button"
              role="option"
              aria-selected={lang === locale.code}
              onClick={() => { setLang(locale.code); close(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition hover:bg-white/5 ${
                lang === locale.code ? "text-brand font-semibold" : "text-zinc-200"
              }`}
            >
              {<Flag locale={locale.code} />}
              <span>{locale.label}</span>
              {lang === locale.code && (
                <svg className="ml-auto w-3.5 h-3.5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
