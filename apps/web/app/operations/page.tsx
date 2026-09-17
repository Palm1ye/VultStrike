"use client";

import { SystemHealth, SystemOverviewPanel } from "@/components/system-health";
import { useLanguage } from "@/components/language-provider";
import { useEffect, useState } from "react";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

type ServerResources = {
  cpu: {
    cores: number;
    usagePercent: number;
    loadAvg: {
      "1min": string;
      "5min": string;
      "15min": string;
    };
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  system: {
    platform: string;
    arch: string;
    uptime: number;
  };
};

type ControlRoomStats = {
  activeMatches: number;
  queuedPlayers: number;
  avgSpinUpSeconds: number;
};

type SystemStatus = "healthy" | "warning" | "critical";

function getSystemStatus(cpuUsage: number, memoryUsage: number): SystemStatus {
  if (cpuUsage >= 95 || memoryUsage >= 95) return "critical";
  if (cpuUsage >= 80 || memoryUsage >= 80) return "warning";
  return "healthy";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 GB";
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

export default function OperationsPage() {
  const { t } = useLanguage();
  const [resources, setResources] = useState<ServerResources | null>(null);
  const [controlRoom, setControlRoom] = useState<ControlRoomStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadResources() {
      try {
        const [res, control] = await Promise.all([
          fetch(`${API_BASE}/status/resources`, { cache: "no-store" }),
          fetch(`${API_BASE}/status/control-room`, { cache: "no-store" })
        ]);
        if (!res.ok) throw new Error("Failed to load server resources");
        const data = await res.json();
        const controlData = control.ok ? await control.json() : null;
        if (active) {
          setResources(data);
          setControlRoom(controlData);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(t("operations.error.loadResources"));
        }
      } finally {
        setLoading(false);
      }
    }

    loadResources();
    const interval = setInterval(loadResources, 5000); // Update every 5 seconds

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [t]);

  return (
    <main className="max-w-6xl mx-auto py-12 px-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{t("operations.title")}</h1>
        <p className="text-sm text-zinc-400">{t("operations.subtitle")}</p>
      </div>

      <section className="grid lg:grid-cols-2 gap-6">
        <SystemHealth />
        <SystemOverviewPanel />
      </section>

      <section className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{t("operations.resourcesTitle")}</h2>
          {resources && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">{t("operations.systemStatusLabel")}</span>
              {(() => {
                const status = getSystemStatus(resources.cpu.usagePercent, resources.memory.usagePercent);
                const statusConfig = {
                  healthy: { color: "text-emerald-400", bg: "bg-emerald-400/20", border: "border-emerald-400/30", label: t("operations.status.healthy") },
                  warning: { color: "text-amber-400", bg: "bg-amber-400/20", border: "border-amber-400/30", label: t("operations.status.warning") },
                  critical: { color: "text-rose-400", bg: "bg-rose-400/20", border: "border-rose-400/30", label: t("operations.status.critical") }
                };
                const config = statusConfig[status];
                return (
                  <span className={`text-xs px-2 py-1 rounded-full border ${config.border} ${config.bg} ${config.color}`}>
                    {config.label}
                  </span>
                );
              })()}
            </div>
          )}
        </div>
        
        {error ? (
          <p className="text-rose-300">{error}</p>
        ) : loading ? (
          <p className="text-zinc-400">{t("operations.loading")}</p>
        ) : resources ? (
          <div className="grid md:grid-cols-2 gap-4">
            {/* CPU Usage */}
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("operations.cpu.title")}</p>
                {resources.cpu.usagePercent >= 95 && (
                  <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full border border-rose-500/30 animate-pulse">
                    {t("operations.badge.critical")}
                  </span>
                )}
                {resources.cpu.usagePercent >= 80 && resources.cpu.usagePercent < 95 && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                    {t("operations.badge.warning")}
                  </span>
                )}
              </div>
              
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-4xl font-bold text-white">{resources.cpu.usagePercent.toFixed(1)}%</p>
                  <p className="text-xs text-zinc-500 mt-1">{resources.cpu.cores} {t("operations.cpu.cores")}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">{t("operations.cpu.loadAverage")}</p>
                  <p className="text-sm text-zinc-300">{resources.cpu.loadAvg["1min"]}</p>
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      resources.cpu.usagePercent >= 95 
                        ? "bg-rose-500" 
                        : resources.cpu.usagePercent >= 80 
                          ? "bg-amber-400" 
                          : "bg-emerald-400"
                    }`}
                    style={{ width: `${Math.min(resources.cpu.usagePercent, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>0%</span>
                  <span>50%</span>
                  <span>80%</span>
                  <span>95%</span>
                  <span>100%</span>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
                <div className="text-center">
                  <p className="text-[10px] text-zinc-500">{t("operations.cpu.load1")}</p>
                  <p className="text-xs font-medium text-zinc-300">{resources.cpu.loadAvg["1min"]}</p>
                </div>
                <div className="text-center border-x border-white/5">
                  <p className="text-[10px] text-zinc-500">{t("operations.cpu.load5")}</p>
                  <p className="text-xs font-medium text-zinc-300">{resources.cpu.loadAvg["5min"]}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-zinc-500">{t("operations.cpu.load15")}</p>
                  <p className="text-xs font-medium text-zinc-300">{resources.cpu.loadAvg["15min"]}</p>
                </div>
              </div>
            </div>

            {/* Memory Usage */}
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("operations.memory.title")}</p>
                {resources.memory.usagePercent >= 95 && (
                  <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full border border-rose-500/30 animate-pulse">
                    {t("operations.badge.critical")}
                  </span>
                )}
                {resources.memory.usagePercent >= 80 && resources.memory.usagePercent < 95 && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                    {t("operations.badge.warning")}
                  </span>
                )}
              </div>
              
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-4xl font-bold text-white">{resources.memory.usagePercent.toFixed(1)}%</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {resources.memory.used.toFixed(1)} GB / {resources.memory.total.toFixed(1)} GB
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">{t("operations.memory.free")}</p>
                  <p className="text-sm text-emerald-300">{formatBytes(resources.memory.free * 1024 * 1024 * 1024)}</p>
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      resources.memory.usagePercent >= 95 
                        ? "bg-rose-500" 
                        : resources.memory.usagePercent >= 80 
                          ? "bg-amber-400" 
                          : "bg-emerald-400"
                    }`}
                    style={{ width: `${Math.min(resources.memory.usagePercent, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>0%</span>
                  <span>50%</span>
                  <span>80%</span>
                  <span>95%</span>
                  <span>100%</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                <div className="text-center">
                  <p className="text-[10px] text-zinc-500">{t("operations.memory.used")}</p>
                  <p className="text-xs font-medium text-zinc-300">{resources.memory.used.toFixed(1)} GB</p>
                </div>
                <div className="text-center border-l border-white/5">
                  <p className="text-[10px] text-zinc-500">{t("operations.memory.free")}</p>
                  <p className="text-xs font-medium text-emerald-300">{resources.memory.free.toFixed(1)} GB</p>
                </div>
              </div>
            </div>

            {/* System Status Card */}
            <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/30 p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{t("operations.systemSummary.title")}</p>
                <p className="text-xs text-zinc-400">{resources.system.platform} ({resources.system.arch})</p>
              </div>
              
              <div className="grid md:grid-cols-3 gap-4">
                <div className="rounded-xl bg-white/5 p-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{t("operations.systemSummary.uptime")}</p>
                  <p className="text-xl font-semibold text-white">
                    {Math.floor(resources.system.uptime / 60)}
                    {t("operations.systemSummary.hoursShort")} {resources.system.uptime % 60}
                    {t("operations.systemSummary.minutesShort")}
                  </p>
                </div>
                
                <div className="rounded-xl bg-white/5 p-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{t("operations.systemSummary.totalLoad")}</p>
                  <p className={`text-xl font-semibold ${
                    (resources.cpu.usagePercent + resources.memory.usagePercent) / 2 >= 90
                      ? "text-rose-400"
                      : (resources.cpu.usagePercent + resources.memory.usagePercent) / 2 >= 70
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }`}>
                    {((resources.cpu.usagePercent + resources.memory.usagePercent) / 2).toFixed(1)}%
                  </p>
                </div>
                
                <div className="rounded-xl bg-white/5 p-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{t("operations.systemSummary.matchmaking")}</p>
                  <p className={`text-sm font-medium ${
                    getSystemStatus(resources.cpu.usagePercent, resources.memory.usagePercent) === "critical"
                      ? "text-rose-400"
                      : getSystemStatus(resources.cpu.usagePercent, resources.memory.usagePercent) === "warning"
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }`}>
{getSystemStatus(resources.cpu.usagePercent, resources.memory.usagePercent) === "critical"
                      ? t("operations.systemSummary.matchmakingQueued")
                      : getSystemStatus(resources.cpu.usagePercent, resources.memory.usagePercent) === "warning"
                        ? t("operations.systemSummary.matchmakingSlowed")
                        : t("operations.systemSummary.matchmakingActive")}
                  </p>
                </div>
              </div>
              
              {getSystemStatus(resources.cpu.usagePercent, resources.memory.usagePercent) === "critical" && (
                <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                  <p className="text-sm text-rose-300">
                    <span className="font-semibold">{t("operations.alert.criticalPrefix")}</span>{" "}
                    {t("operations.alert.criticalBody", {
                      active: controlRoom?.activeMatches ?? 0,
                      eta: Math.max(
                        60,
                        Math.round(((controlRoom?.activeMatches ?? 0) * 30) + ((controlRoom?.queuedPlayers ?? 0) * 10))
                      )
                    })}
                  </p>
                </div>
              )}
              
              {getSystemStatus(resources.cpu.usagePercent, resources.memory.usagePercent) === "warning" && (
                <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <p className="text-sm text-amber-300">
                    <span className="font-semibold">{t("operations.alert.warningPrefix")}</span> {t("operations.alert.warningBody")}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
