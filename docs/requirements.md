# VultStrike Arena – Competitive Counter-Strike 2 Platform

## Vision
Build VultStrike Arena, a self-contained competitive hub for Counter-Strike 2 where players can seamlessly create, join, and manage small-sided matches (1v1, 2v2, 3v3) directly from the web. The platform must manage matchmaking, rankings, leaderboards, match servers, anti-cheat, and rewards without third-party coordination or references to existing tournament portals.

## Core User Stories
1. **Account & Identity**
   - Players can register/login via email, Steam, or Discord OAuth.
   - Each user links their CS2/Steam profile for stats, bans, and VAC verification.
   - Users maintain gamer profiles with avatars, preferred roles, MMR history, and ban status.

2. **Match Lifecycle**
   - Users browse/join queues for 1v1, 2v2, 3v3 ladders.
   - Automatic lobby formation once queue fills required slots; captains can veto maps.
   - Site provisions/assigns CS2 server instances (Faceit-style) and pushes credentials to players.
   - Real-time match status (waiting → live → finished) visible on web.
   - Server reports match results (scoreline, MVP, rounds) back to platform via secure webhook/API.

3. **Ranking & Leaderboards**
   - Separate seasonal ladders per mode, with ELO/MMR adjustments per match.
   - Global leaderboard with filters (region, friends, clan, weekly).
   - Player rank tiers (Bronze → Mythic) with promotion/demotion rules.

4. **Rewards & Economy**
   - XP/credit rewards for match completion, streaks, sportsmanship.
   - Small gifts (cases, skins, coupons) claimable from loot wheel/season pass.
   - Storefront where credits can be redeemed for cosmetic drops (inventory not handled by site).

5. **Server Orchestration & Anti-Cheat**
   - Integration with CS2 dedicated servers via Steam Game Server Login Tokens (GSLT).
   - Automated provisioning (Docker/Kubernetes) per match with map pool rotation.
   - Anti-cheat hooks (VAC, optional third-party) and manual admin review dashboard.

6. **Community & Support**
   - Match chat, party chat, and dispute resolution ticketing.
   - Admin dashboard for bans, match overrides, reward grants.
   - Notifications (web, email, Discord) for match invites, rewards, bans.

7. **Monetization & Compliance**
   - Optional subscriptions for premium queues and boosted rewards.
   - GDPR-compliant data handling, consent, and account deletion workflows.

## Non-Functional Requirements
- **Scalability**: Handle thousands of concurrent queues and matches with auto-scaling servers.
- **Latency**: Queue → server ready under 30 seconds; live updates <1s (WebSockets).
- **Security**: OAuth, JWT, RBAC, rate limiting, audit logs.
- **Reliability**: Match result integrity, at-least-once delivery with idempotent processing.
- **Observability**: Metrics, tracing, structured logs for matches and infra.
- **Localization**: Primary surfaces are available in English and Turkish with a runtime toggle; translations must cover CTAs, menu labels, and critical stats.

## External Integrations
- Steam Web API (player summaries, bans, match history)
- Steam Game Servers (GSLT management)
- Payment gateway (Stripe/PayPal) for premium credits
- Discord webhooks/bot for notifications

## Success Criteria
- Users can join/complete matches entirely via the website without manual server handling.
- Rankings and leaderboards update automatically after each match.
- Players receive rewards and can redeem them for items/credits.
- Admins manage disputes, bans, and server health from a single control panel.
