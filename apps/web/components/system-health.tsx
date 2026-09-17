"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "./language-provider";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

type ServiceStatus = {
  status: "optimal" | "deployed" | "scanning" | "offline";
  detail: string;
};

type StatusResponse = {
  ok: boolean;
  timestamp: string;
  uptimeSeconds: number;
  services: Record<string, ServiceStatus>;
};

function useSystemStatus(t: (key: string, params?: Record<string, string | number>) => string) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const res = await fetch(`${API_BASE}/status`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(t("system.statusUnavailable"));
        }
        const data = (await res.json()) as StatusResponse;
        if (active) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : t("system.statusUnavailable"));
        }
      }
    }

    void loadStatus();
    const interval = window.setInterval(loadStatus, 20000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [t]);

  const serviceList = useMemo(() => {
    if (!status?.services) {
      return [
        { key: "api", label: t("system.service.api"), detail: t("system.awaiting"), status: "scanning" },
        { key: "database", label: t("system.service.database"), detail: t("system.awaiting"), status: "scanning" },
        { key: "matchmaker", label: t("system.service.matchmaker"), detail: t("system.awaiting"), status: "scanning" }
      ];
    }

    return Object.entries(status.services).map(([key, value]) => {
      const label =
        key === "api"
          ? t("system.service.api")
          : key === "database"
            ? t("system.service.database")
            : key === "matchmaker"
              ? t("system.service.matchmaker")
              : key.replace(/\b\w/g, (char) => char.toUpperCase());

      return { key, label, detail: value.detail, status: value.status };
    });
  }, [status, t]);

  return { status, error, serviceList };
}

export function SystemHealth() {
  const { t } = useLanguage();
  const { status, error, serviceList } = useSystemStatus(t);
  const updatedAt = status?.timestamp ? new Date(status.timestamp) : null;
  const updatedLabel = updatedAt ? updatedAt.toLocaleTimeString() : t("system.subtitle");

  return (
    <div className="glass-panel p-6 space-y-4" id="system">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{t("system.title")}</h3>
        <span className="text-xs text-zinc-500">{updatedLabel}</span>
      </div>
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      <ul className="space-y-3">
        {serviceList.map((system) => (
          <li key={system.key} className="flex items-center justify-between bg-black/30 rounded-xl border border-white/5 px-4 py-3">
            <div>
              <p className="text-sm text-zinc-400">{system.label}</p>
              <p className="text-lg font-semibold text-white">{system.detail}</p>
            </div>
            <div className="text-right text-xs">
              <p className="text-emerald-300">{t(`system.status.${system.status}`)}</p>
              {status?.uptimeSeconds ? (
                <p className="text-zinc-500">{t("system.uptime", { minutes: Math.round(status.uptimeSeconds / 60) })}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SystemOverviewPanel() {
  const { t } = useLanguage();
  const { status, serviceList } = useSystemStatus(t);
  const updatedAt = status?.timestamp ? new Date(status.timestamp) : null;
  const updatedLabel = updatedAt ? updatedAt.toLocaleTimeString() : t("system.subtitle");
  const operationalCount = serviceList.filter((s) => s.status === "optimal" || s.status === "deployed").length;
  const healthScore = Math.round((operationalCount / serviceList.length) * 100);

  return (
    <div className="glass-panel p-6 space-y-6" id="control-room">
      <div>
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">{t("system.operations")}</p>
        <h3 className="text-2xl font-semibold">{t("system.overview")}</h3>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("system.healthScore")}</p>
          <p className="text-3xl font-semibold text-white">{healthScore}%</p>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-brand" style={{ width: `${healthScore}%` }} />
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("system.servicesOnline")}</p>
          <p className="text-3xl font-semibold text-white">{operationalCount}/{serviceList.length}</p>
          <p className="text-xs text-zinc-500">{t("system.updated", { time: updatedLabel })}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("system.uptimeLabel")}</p>
          <p className="text-3xl font-semibold text-white">{status?.uptimeSeconds ? Math.round(status.uptimeSeconds / 60) : 0}m</p>
          <p className="text-xs text-zinc-500">{t("system.uptimeNote")}</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("system.serviceStates")}</p>
        <div className="space-y-2">
          {serviceList.map((system) => (
            <div key={system.key} className="flex items-center justify-between text-sm text-zinc-300">
              <span>{system.label}</span>
              <div className="flex-1 mx-3 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full ${system.status === "optimal" || system.status === "deployed" ? "bg-emerald-400" : system.status === "scanning" ? "bg-amber-400" : "bg-rose-400"}`}
                  style={{ width: system.status === "optimal" || system.status === "deployed" ? "100%" : system.status === "scanning" ? "60%" : "20%" }}
                />
              </div>
              <span className="text-xs text-zinc-500">{t(`system.status.${system.status}`)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-zinc-500">{t("system.liveUpdates")}</div>
    </div>
  );
}
