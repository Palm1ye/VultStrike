export function normalizeConnectIpPort(connect?: string | null) {
  if (!connect) return null;
  const ipPort = connect.replace(/^connect\s+/i, "").trim();
  return ipPort.length ? ipPort : null;
}

export function buildConsoleConnectCommand(connect?: string | null, lobbyCode?: string | null) {
  const ipPort = normalizeConnectIpPort(connect);
  if (!ipPort) return null;
  const safeLobbyCode = lobbyCode?.trim();
  return safeLobbyCode ? `connect ${ipPort}; password ${safeLobbyCode}` : `connect ${ipPort}`;
}

export function buildSteamRunConnectUrl(connect?: string | null, lobbyCode?: string | null) {
  const ipPort = normalizeConnectIpPort(connect);
  if (!ipPort) return null;
  const safeLobbyCode = lobbyCode?.trim();
  const command = safeLobbyCode ? `+connect ${ipPort} +password ${safeLobbyCode}` : `+connect ${ipPort}`;
  // Steam handles spaces but can be picky about encoded "+" in the command.
  const encoded = command.replace(/ /g, "%20");
  return `steam://rungameid/730//${encoded}`;
}

export function buildSteamConnectTargets(connect?: string | null, lobbyCode?: string | null) {
  const ipPort = normalizeConnectIpPort(connect);
  if (!ipPort) return null;
  const safeLobbyCode = lobbyCode?.trim();
  const direct = safeLobbyCode ? `steam://connect/${ipPort}/${safeLobbyCode}` : `steam://connect/${ipPort}`;
  const run = buildSteamRunConnectUrl(connect, lobbyCode);
  return { direct, run, ipPort };
}

function openProtocolUrl(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Fallback for browsers that ignore programmatic clicks.
  window.location.href = url;
}

export function launchSteamConnect(targets: { direct?: string | null; run?: string | null }) {
  const run = targets.run ?? null;
  const direct = targets.direct ?? null;
  if (!run && !direct) return;

  if (run) {
    openProtocolUrl(run);
    if (direct) {
      // If Steam doesn't grab focus quickly, try the direct protocol.
      window.setTimeout(() => {
        if (!document.hidden) {
          openProtocolUrl(direct);
        }
      }, 800);
    }
    return;
  }

  if (direct) {
    openProtocolUrl(direct);
  }
}
