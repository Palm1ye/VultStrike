"use client";

import Link from "next/link";
import { useLanguage } from "@/components/language-provider";

export function SiteFooter() {
  const { t } = useLanguage();

  return (
    <footer className="mt-16 border-t border-white/5 bg-black/20">
      <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand to-[#ff5f1f] flex items-center justify-center font-black text-black text-xs">
            VS
          </div>
          <span>VultStrike Arena</span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-700">v0.3.1</span>
        </div>
        <div className="flex items-center gap-5">
          <a href="https://github.com/Palm1ye/Vultstrike" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
            </svg>
            GitHub
          </a>
          <a href="https://discord.gg/bYCgf36Hkf" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path d="M13.545 2.907A13.227 13.227 0 0 0 10.227 1.7a.061.061 0 0 0-.065.03c-.143.251-.302.579-.413.84a12.19 12.19 0 0 0-3.498 0 8.114 8.114 0 0 0-.419-.84.061.061 0 0 0-.064-.03 13.14 13.14 0 0 0-3.32 1.207.055.055 0 0 0-.024.02C.533 5.683-.32 8.372.099 11.028a.064.064 0 0 0 .024.044 13.305 13.305 0 0 0 3.995 2.03.061.061 0 0 0 .066-.022c.308-.423.582-.87.818-1.342a.06.06 0 0 0-.032-.082 8.633 8.633 0 0 1-1.248-.595.06.06 0 0 1-.006-.099c.084-.063.168-.129.248-.195a.06.06 0 0 1 .062-.008c2.619 1.195 5.458 1.195 8.046 0a.06.06 0 0 1 .063.007c.08.067.164.133.248.196a.06.06 0 0 1-.006.1 8.31 8.31 0 0 1-1.249.594.06.06 0 0 0-.031.083c.24.472.514.919.817 1.341a.06.06 0 0 0 .066.022 13.217 13.217 0 0 0 4.001-2.03.06.06 0 0 0 .024-.043c.5-3.07-.838-5.735-2.322-8.1a.049.049 0 0 0-.024-.02zM5.33 9.388c-.79 0-1.438-.724-1.438-1.612 0-.888.633-1.613 1.438-1.613.813 0 1.45.731 1.438 1.613 0 .888-.633 1.612-1.438 1.612zm5.34 0c-.79 0-1.438-.724-1.438-1.612 0-.888.633-1.613 1.438-1.613.813 0 1.45.731 1.438 1.613 0 .888-.626 1.612-1.438 1.612z" />
            </svg>
            Discord
          </a>
          <Link href="/whitepaper" className="hover:text-white transition">{t("footer.whitepaper")}</Link>
          <a href="/operations" className="hover:text-white transition">{t("footer.status")}</a>
        </div>
      </div>
    </footer>
  );
}
