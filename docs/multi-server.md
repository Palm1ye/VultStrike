# Multi-Server Scaling Notes (Do Not Deploy Yet)

These notes describe a safe path to add extra CS2 host machines later without breaking the current production setup. This is documentation only and should not change behavior today.

**Current Single-Node Architecture (as of 2026-02-04)**
1. The API (NestJS) starts CS2 servers locally via `DockerService` using the local Docker daemon.
1. CS2 containers mount host paths:
1. `/home/steam/cs2` -> `/home/steam/cs2-dedicated`
1. `/home/steam/Steam` -> `/home/steam/Steam`
1. The API sets container env vars like `VS_MATCH_ID`, `VS_WEBHOOK_URL`, `VS_API_BASE`, `VS_PUBLIC_HOST`, `VS_PUBLIC_PORT`, `STEAM_GSLT`.
1. `VS_WEBHOOK_URL` is built from `API_PUBLIC_URL` or `API_INTERNAL_URL` (fallback `http://host.docker.internal:4000`).
1. The API writes `match.serverEndpoint` as `connect host:port`.
1. The CS2 plugin reports results to `/matches/webhook/result`.

**Why Scaling Is Needed**
1. A single box will saturate CPU/RAM at ~20 concurrent matches.
1. CS2 servers are the main load, not the API.

**Target Multi-Host Design (Agent-Based, Low Risk)**
1. Run a small "game-server-agent" on each CS2 host machine.
1. The API calls the agent to start/stop servers instead of local Docker.
1. The agent uses local Docker on its own host and returns `containerId` and public `endpoint`.
1. The API stays the single source of truth for match records and webhooks.

**Suggested Minimal Agent API**
1. `GET /health` -> ok, load, capacity, active containers.
1. `POST /servers/start` -> `{ matchId, map, region, port, env }`.
1. `POST /servers/stop` -> `{ containerId }`.
1. Optional: `GET /servers/active`.

**DB Schema Draft (future)**
1. `game_server` table:
1. `id`, `name`, `region`, `status`, `capacity`, `activeMatches`
1. `publicHost`, `publicPortMin`, `publicPortMax`
1. `agentBaseUrl`, `agentToken`, `lastHeartbeat`

**API Changes (future, guarded by flag)**
1. Add `GameServerService` that selects the least-loaded server.
1. Move Docker logic behind an interface:
1. `LocalDockerProvider` (current behavior).
1. `RemoteAgentProvider` (new behavior).
1. Add feature flag: `GAME_SERVER_STRATEGY=local|agent`.
1. Default stays `local` until the new path is proven.

**Security**
1. Agents require `Authorization: Bearer <token>`.
1. Firewall allowlist to API IP only.
1. Rotate tokens per host if possible.

**Safe Migration Plan (no downtime)**
1. Add `game_server` table and admin UI read-only view.
1. Deploy an agent on the current machine only, but keep `GAME_SERVER_STRATEGY=local`.
1. Implement `RemoteAgentProvider` and feature flag.
1. Add a second host as `STANDBY` in DB.
1. Turn on agent mode only for a small scope:
1. One region, or only `1v1` for a day.
1. Observe metrics and rollback by switching flag back to `local`.

**New Host Checklist**
1. Docker installed and can pull CS2 image.
1. Steam GSLT and API keys available.
1. Open ports for CS2 UDP/TCP (e.g. 27015+ range).
1. Paths for CS2 content on that host match expected mount locations.
1. Agent process runs on boot (systemd or pm2).

**Important**
1. Do not change current prod behavior until the agent path is fully tested.
1. Keep `LocalDockerProvider` as a fallback for easy rollback.

