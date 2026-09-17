import { Injectable } from "@nestjs/common";

type WebhookEventType = "score" | "result" | "player" | "stats";

type WebhookAuditEvent = {
  type: WebhookEventType;
  matchId: string;
  ok: boolean;
  at: string;
  detail?: string | null;
};

type WebhookAuditSummary = {
  total: number;
  ok: number;
  failed: number;
  lastOkAt?: string;
  lastFailAt?: string;
  byType: Record<WebhookEventType, { total: number; ok: number; failed: number }>;
  recent: WebhookAuditEvent[];
};

const EVENT_TYPES: WebhookEventType[] = ["score", "result", "player", "stats"];
const MAX_EVENTS = 50;

@Injectable()
export class WebhookAuditService {
  private events: WebhookAuditEvent[] = [];
  private total = 0;
  private ok = 0;
  private failed = 0;
  private lastOkAt?: string;
  private lastFailAt?: string;
  private lastAlertAt = new Map<string, number>();
  private byType: WebhookAuditSummary["byType"] = {
    score: { total: 0, ok: 0, failed: 0 },
    result: { total: 0, ok: 0, failed: 0 },
    player: { total: 0, ok: 0, failed: 0 },
    stats: { total: 0, ok: 0, failed: 0 }
  };

  record(type: WebhookEventType, matchId: string, ok: boolean, detail?: string | null) {
    if (!EVENT_TYPES.includes(type)) return;
    const at = new Date().toISOString();
    const entry: WebhookAuditEvent = { type, matchId, ok, at, detail: detail ?? null };
    this.events.unshift(entry);
    if (this.events.length > MAX_EVENTS) {
      this.events.pop();
    }

    this.total += 1;
    this.byType[type].total += 1;

    if (ok) {
      this.ok += 1;
      this.byType[type].ok += 1;
      this.lastOkAt = at;
    } else {
      this.failed += 1;
      this.byType[type].failed += 1;
      this.lastFailAt = at;
      this.maybeAlert(type, matchId, detail ?? null);
    }
  }

  private maybeAlert(type: WebhookEventType, matchId: string, detail: string | null) {
    const url = (process.env.ALERT_WEBHOOK_URL ?? "").trim();
    if (!url) return;

    const throttleSeconds = Number(process.env.ALERT_THROTTLE_SECONDS ?? 60);
    const throttleMs = Number.isFinite(throttleSeconds) ? Math.max(5, throttleSeconds) * 1000 : 60_000;

    const now = Date.now();
    const key = `${type}`;
    const lastAt = this.lastAlertAt.get(key) ?? 0;
    if (now - lastAt < throttleMs) return;
    this.lastAlertAt.set(key, now);

    const safeDetail = (detail ?? "unknown error").slice(0, 300);
    const message = `VultStrike webhook failed: type=${type} matchId=${matchId} detail=${safeDetail}`;

    // Best-effort. Supports Discord (content) and Slack (text).
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message, text: message })
    }).catch(() => undefined);
  }

  summary(): WebhookAuditSummary {
    return {
      total: this.total,
      ok: this.ok,
      failed: this.failed,
      lastOkAt: this.lastOkAt,
      lastFailAt: this.lastFailAt,
      byType: this.byType,
      recent: [...this.events]
    };
  }
}
