export async function requestMatchFoundNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported" as const;
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }

  try {
    return await Notification.requestPermission();
  } catch {
    return "default" as const;
  }
}

export function showMatchFoundNotification(details: { map: string; lobbyCode?: string | null; matchId: string }) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return null;
  if (Notification.permission !== "granted") return null;

  const body = details.lobbyCode
    ? `Lobby ${details.lobbyCode} hazır. Maça katılabilirsin.`
    : `Maç ${details.matchId.slice(0, 8)} hazır. Maça katılabilirsin.`;

  const notification = new Notification("VultStrike • Match found", {
    body: `${details.map || "Preparing map"}\n${body}`,
    tag: `match-found-${details.matchId}`,
    requireInteraction: true
  });

  notification.onclick = () => {
    window.focus();
    window.open(`/match/${details.matchId}`, "_blank", "noopener,noreferrer");
    notification.close();
  };

  return notification;
}
