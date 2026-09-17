# VultStrike Arena Roadmap

## ✅ Completed
- [x] Match queue + ticket ingestion with MMR-aware pairing
- [x] Match creation and participant assignment
- [x] CS2 server provisioning + connect strings (Docker & Mock mode)
- [x] Workshop map support with automatic download and caching
- [x] 1v1 workshop maps: Tirgo, Bluelines, Newage
- [x] Map pool management and rotation system
- [x] Map API endpoints for configuration
- [x] Result ingestion and server release on finish
- [x] CS2 reporter plugin for live score + result webhooks
- [x] Live status endpoint and UI indicator
- [x] Localization (EN/TR) and responsive dashboard layout
- [x] Steam OpenID authentication with profile enrichment
- [x] Real-time queue status polling and match-found notifications
- [x] Community features (leaderboard, shoutbox)
- [x] Drizzle ORM integration alongside Prisma
- [x] Matchmaking console for development/testing
- [x] Scoreboard with MMR delta calculation
- [x] Rewards economy MVP (credits wallet + case opening)

## 🚧 Next (0–3 months)
- [ ] Real-time queue updates via SSE/WebSockets
- [ ] Matchmaking tuning (region pools, party MMR, anti-smurf heuristics)
- [ ] Auth hardening (Steam-only enforcement, refresh tokens, CSRF)
- [ ] Automated result validation + retry pipeline
- [ ] Ops incidents, status history, and alert hooks

## 🔧 Mid term (3–6 months)
- [ ] Rewards progression (XP, quests, inventory economy)
- [ ] Anti-cheat ingestion and trust automation
- [ ] Dedicated server fleet API + autoscaling
- [ ] Observability (structured logs, tracing, metrics)
- [ ] Tournament brackets + events pipeline

## 🧭 Long term (6–12 months)
- [ ] Season management (placements, resets, rewards)
- [ ] Premium lanes + private lobbies
- [ ] Multi-region routing and failover
- [ ] Mobile app companion
