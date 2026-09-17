# System Architecture – VultStrike Arena CS2 Platform

## Current Implementation
- **Frontend**: Next.js 14 (App Router) with Tailwind CSS, React Query, HTTP polling for real-time updates
- **API**: NestJS with Fastify adapter, REST endpoints, JWT cookie-based auth
- **Database**: PostgreSQL 16 via Drizzle ORM, Redis 7 for caching
- **Server Provisioning**: Docker-based CS2 containers via Dockerode, automatic port allocation
- **Deployment**: Docker Compose for development, Dokploy (Docker Compose + Traefik) for production
- **Matchmaking**: In-process timer loop (no external queue broker currently)
- **Services**: Standalone Node.js microservices for orchestrator, rewards, anti-cheat (under `services/`)

## Target Architecture (Future Direction)
The sections below describe the longer-term direction, not the current production setup.
Some components are aspirational and are included for planning purposes.

## Overview
The platform is a cloud-native web application composed of a modular monorepo with shared TypeScript tooling. It exposes a modern Next.js web client, a NestJS API gateway, task-specific microservices for matchmaking and rewards, and an infrastructure layer that provisions CS2 servers on demand via Kubernetes/Docker and Steam Game Server Login Tokens (GSLT).

```
                    +-----------------------+
                    |     Next.js Web App   |
                    |  (SSR + WebSockets)   |
                    +----------+------------+
                               |
                               v
          +---------------------------------------------+
          |        NestJS API Gateway (GraphQL+REST)    |
          | Auth, Profiles, Rankings, Leaderboards,     |
          | Payments, Admin, Notifications              |
          +------+------+-------+--------+--------------+
                 |      |       |        |
                 v      v       v        v
        +--------+  +---+---+  +-+----+  +------------------+
        | Match-  |  |Reward|  |Anti- |  | Notification Bus |
        | maker   |  |Engine|  |Cheat |  | (NATS/Redis)     |
        +----+----+  +---+---+  +-+----+  +------------------+
             |           |        |                |
             v           v        v                v
       +-----------+  +------+  +------+   +------------------+
       | Orchestr- |  |Post- |  |Redis |   | Observability    |
       | ator      |  |gres  |  |Cache |   | (Tempo/Loki/Graf) |
       +-----------+  +------+  +------+   +------------------+
             |
             v
        +----------+
        | CS2 GSLT |
        | Servers  |
        +----------+
```

## Technology Choices
- **Language/Runtime**: TypeScript (Node.js 20+) for shared libraries; Go for high-throughput orchestrator if needed.
- **Frontend**: Next.js 14 (App Router), Tailwind, React Query, tRPC/GraphQL client, Zustand for state, WebSocket hooks for live match status.
- **API Gateway**: NestJS with hybrid GraphQL (queries/mutations) + REST endpoints for webhooks, plus Socket.IO for real-time events.
- **Data**: PostgreSQL (match history, ladders, users), Redis (queues, matchmaking state, rate limiting), ClickHouse/BigQuery (analytics).
- **Messaging**: NATS JetStream or Kafka for event-driven workflows (match-started, match-finished, reward-granted).
- **Server Provisioning**: Kubernetes (GKE/EKS) with custom controller that spins ephemeral CS2 containers; fallback to bare-metal pool.
- **CI/CD**: GitHub Actions with Nx/Turborepo caching, Docker builds, Helm deploys.

## Services
1. **Web (Next.js)**
   - Routes for auth, dashboards, queue browser, match viewer, rewards, admin.
   - Server Actions hitting GraphQL API; Edge functions for match widgets.
   - WebSocket subscription to `/live/matches` for lobby updates.

2. **API Gateway (NestJS)**
   - Modules: Auth, Users, Matches, Queues, Rankings, Rewards, Payments, Admin, Notifications.
   - Integrates with Steam OAuth, Stripe, Discord webhooks.
   - Publishes domain events to NATS for downstream processors.

3. **Matchmaker Service**
   - Consumes queue events, uses Elo-aware matching with latency filter.
   - Calls Orchestrator to request CS2 server, returns lobby token to API.
   - Runs as worker pods with Redis Streams or NATS subscriptions.

4. **Server Orchestrator**
   - Maintains pool of warm CS2 containers (Docker image + GSLT + SourceMod plugin).
   - On `match.created`, picks best region cluster, injects match config, and exposes join credentials.
   - Listens for match result events from servers (via gRPC/Webhook) and forwards to API.

5. **Rewards Engine**
   - Listens for `match.finished`, `streak.achieved`, `ticket.resolved` events.
   - Calculates XP, credits, loot roll probability; updates inventories.

6. **Anti-Cheat Service**
   - Aggregates VAC results, third-party detections, manual reports.
   - Assigns trust score and can auto-flag accounts.

## Data Model Sketch
- `users`: id, steam_id, email, mmr_per_mode, rank_tier, trust_score, ban_flags.
- `matches`: id, mode, server_id, map, status, rounds, winner_id, created_at, finished_at.
- `match_participants`: match_id, user_id, team, kills, adr, mvp.
- `queues`: id, mode, region, elo_range, state.
- `rewards`: id, user_id, type, payload, claimed_at.
- `leaderboards`: season_id, mode, user_id, mmr, rank.

## API Contract Highlights
- `mutation QueueJoin(mode, region)` → lobbyTicket
- `subscription MatchStatus(matchId)` → { waiting | warmup | live | finished }
- `mutation ReportScore(matchId, payload)` (server-only) → ack
- `query Leaderboard(mode, season, filters)` → paginated ranks
- `mutation ClaimReward(rewardId)` → inventory item
- `query Account(userId)` → trust, MMR snapshot, linked providers
- `query AccountQueue(userId)` → active tickets, party readiness, preferred regions
- `query MatchScoreboard(matchId)` → teams, rounds, player stats, MMR deltas

## Deployment Topology
- **Environments**: dev (Docker Compose), staging (K8s cluster with test Steam tokens), prod (multi-region K8s).
- **Kubernetes**: Helm charts per service, Horizontal Pod Autoscaler on API, matchmaker, orchestrator.
- **CS2 Servers**: Dedicated nodepool with GPU disabled, using game server images; metrics scraped via Prometheus exporter.
- **Observability**: OpenTelemetry instrumentation across services, Grafana dashboards for queue times, server usage, reward latency.

## Security
- OAuth + JWT tokens (short-lived access, long-lived refresh)
- Role-based access (player, moderator, admin)
- Audit logs for match overrides and reward grants
- Mutual TLS between orchestrator and servers; signed server callbacks
- Rate limiting on queue joins and reward claims

## Roadmap Snapshot
1. Milestone Alpha: Auth, queue, manual server assignment, basic leaderboard.
2. Milestone Beta: Full automation (matchmaker + orchestrator), rewards, subscription monetization.
3. Milestone GA: Anti-cheat integrations, advanced analytics, community tournaments & ladders.
