export type MatchmakingIntent = {
  mode?: "1v1" | "2v2" | "3v3";
  source?: string;
  timestamp: number;
};

const MATCHMAKING_INTENT_KEY = "vultstrike_matchmaking_intent";
const MAX_AGE_MS = 10 * 60 * 1000;

export function saveMatchmakingIntent(intent: Omit<MatchmakingIntent, "timestamp">) {
  if (typeof window === "undefined") return;
  try {
    const payload: MatchmakingIntent = { ...intent, timestamp: Date.now() };
    window.localStorage.setItem(MATCHMAKING_INTENT_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function readMatchmakingIntent(): MatchmakingIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MATCHMAKING_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MatchmakingIntent;
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > MAX_AGE_MS) {
      window.localStorage.removeItem(MATCHMAKING_INTENT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearMatchmakingIntent() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MATCHMAKING_INTENT_KEY);
  } catch {
    // ignore
  }
}
