<p align="center">
  <h1 align="center">⚡ VultStrike Arena</h1>
  <p align="center">
    Open-source competitive matchmaking platform for Counter-Strike 2
    <br />
    <a href="#-quick-start"><strong>Quick Start »</strong></a>
    ·
    <a href="docs/architecture.md"><strong>Architecture »</strong></a>
    ·
    <a href="ROADMAP.md"><strong>Roadmap »</strong></a>
    ·
    <a href="CONTRIBUTING.md"><strong>Contributing »</strong></a>
  </p>
</p>

<br />

> **Status:** Active development · v0.3.x · Contributions welcome

---

## 📖 What is VultStrike?

VultStrike Arena is a self-hostable platform that lets communities run their own competitive CS2 matchmaking — complete with MMR-based queues, automated game server orchestration, and a rewards economy.

Think of it as an open-source alternative to services like FACEIT or ESEA that you can deploy on your own infrastructure.

### Key Features

| Category | Details |
|---|---|
| **Matchmaking** | MMR-based queue with 1v1 / 2v2 / 3v3 modes, skill-aware pairing |
| **Match Lifecycle** | Automated creation, server assignment, live scoring, result processing |
| **CS2 Servers** | Docker-based server provisioning with automatic port allocation & GSLT |
| **Workshop Maps** | Built-in support for Steam Workshop maps (Tirgo, Bluelines, Newage, etc.) |
| **Authentication** | Steam OpenID login with profile enrichment |
| **Community** | Leaderboards, player profiles, shoutbox |
| **Rewards** | Credits wallet, case opening system, XP progression (MVP) |
| **Anti-Cheat** | Service hooks for trust scoring and automated flagging |
| **Admin** | Match controls, player management, system monitoring |
| **i18n** | English and Turkish localization |
| **Mock Mode** | Full development flow without real CS2 servers |

---

## 🏗️ Architecture

VultStrike is a TypeScript monorepo powered by **pnpm workspaces** and **Turborepo**.

```
VultStrike/
├── apps/
│   ├── api/                  # NestJS backend (Fastify, REST, JWT auth)
│   └── web/                  # Next.js 14 frontend (App Router, Tailwind)
├── services/
│   ├── orchestrator/         # CS2 server lifecycle management
│   ├── rewards/              # Credits, XP, case opening
│   ├── anti-cheat/           # Trust scoring & VAC aggregation
│   ├── cs2-image/            # Docker image for CS2 dedicated servers
│   └── cs2-reporter/         # SourceMod plugin for live match reporting
├── packages/
│   └── db/                   # Shared database schemas & utilities
├── docs/                     # Architecture, deployment, and ops guides
└── scripts/                  # Setup, backup, and smoke test scripts
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14, React, Tailwind CSS, React Query |
| **Backend** | NestJS (Fastify adapter), Drizzle ORM |
| **Database** | PostgreSQL 16, Redis 7 |
| **Infrastructure** | Docker, Docker Compose |
| **Build** | pnpm workspaces, Turborepo |
| **CI/CD** | GitHub Actions (lint, test, build, secret scanning) |
| **Language** | TypeScript throughout |

For a deeper dive, see [docs/architecture.md](docs/architecture.md).

---

## 🚀 Quick Start

There are two ways to get running: **manual setup** (more control) or the **automated setup script**.

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org/) | 20+ | LTS recommended |
| [pnpm](https://pnpm.io/) | 8+ | Installed via corepack |
| [Docker](https://docs.docker.com/get-docker/) | 20+ | With Docker Compose plugin |
| [Git](https://git-scm.com/) | 2.x | For cloning the repo |

### Option A: Manual Setup

#### 1. Clone and install

```bash
git clone https://github.com/Palm1ye/Vultstrike.git
cd Vultstrike

# Enable pnpm via corepack (ships with Node.js)
corepack enable

# Install all dependencies
pnpm install
```

#### 2. Configure environment

```bash
# Copy all example env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Now edit the files with your values:

**`.env`** — Database credentials for Docker Compose:
```env
POSTGRES_USER=VultStrike
POSTGRES_PASSWORD=pick-a-strong-password-here
POSTGRES_DB=VultStrike
DATABASE_URL=postgresql://VultStrike:pick-a-strong-password-here@localhost:5433/VultStrike
```

**`apps/api/.env`** — API configuration (minimum required changes):
```env
DATABASE_URL="postgresql://VultStrike:pick-a-strong-password-here@localhost:5433/VultStrike"
JWT_SECRET="generate-a-random-32-char-string"
COOKIE_SECRET="generate-another-random-32-char-string"
MATCH_WEBHOOK_SECRET="generate-yet-another-random-string"
CS2_MOCK_MODE="true"   # ← Keep true for development
```

> **Tip:** Generate random secrets with: `openssl rand -hex 32`

**`apps/web/.env.local`** — Frontend config (defaults are usually fine):
```env
NEXT_PUBLIC_API_BASE="http://localhost:4000"
```

#### 3. Start infrastructure

```bash
# Start PostgreSQL and Redis containers
docker compose up -d

# Verify they're running
docker compose ps
```

This starts:
- **PostgreSQL 16** on `localhost:5433`
- **Redis 7** on `localhost:6380`

#### 4. Run database migrations

```bash
pnpm exec drizzle-kit migrate --config=drizzle.config.ts
```

#### 5. Start development servers

```bash
# Start both API and web in parallel
pnpm dev:all

# Or start them separately:
pnpm dev:api   # → http://localhost:4000
pnpm dev:web   # → http://localhost:3000
```

✅ **You're up!** Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option B: Automated Setup Script

An interactive setup script handles prerequisites, database setup, env file generation, and service startup:

```bash
# Make it executable and run
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The script supports **Ubuntu/Debian**, **Fedora/RHEL**, and **macOS** (via Homebrew).

---

## 🎮 Development Modes

### Mock Mode (recommended for development)

Mock mode simulates the entire CS2 server lifecycle without needing real game servers. This is the default and recommended mode for feature development.

```env
# In apps/api/.env
CS2_MOCK_MODE="true"
```

With mock mode, you can:
- Test the full matchmaking queue flow
- Verify match creation and lifecycle
- Develop UI features end-to-end
- Run CI/CD pipelines without game servers

### Full Orchestration Mode

For testing with real CS2 dedicated servers:

```env
# In apps/api/.env
CS2_MOCK_MODE="false"
```

Additional requirements:
- Steam Game Server Login Token (GSLT) — [get one here](https://steamcommunity.com/dev/managegameservers)
- CS2 dedicated server files on the host machine
- Configured host paths in `apps/api/.env` (see `CS2_HOST_DIR` and related variables)

See [services/cs2-image/README.md](services/cs2-image/README.md) for detailed server configuration.

---

## 📋 Common Commands

```bash
# Development
pnpm dev:all              # Start API + Web concurrently
pnpm dev:api              # Start API only
pnpm dev:web              # Start Web only
pnpm dev:orchestrator     # Start CS2 orchestrator service
pnpm dev:rewards          # Start rewards service
pnpm dev:anti-cheat       # Start anti-cheat service

# Quality
pnpm lint                 # Lint all packages
pnpm test                 # Run all tests
pnpm build                # Build all packages

# Database
pnpm exec drizzle-kit generate --config=drizzle.config.ts   # Generate migration
pnpm exec drizzle-kit migrate --config=drizzle.config.ts    # Apply migrations

# Infrastructure
docker compose up -d      # Start Postgres + Redis
docker compose down       # Stop all containers
docker compose logs -f    # Follow container logs

# Smoke test (requires running API)
./scripts/smoke-test.sh
```

---

## 🚢 Deployment

### Docker Compose (self-hosted)

The project includes production-ready Docker images:

```bash
# Build images
docker build -f Dockerfile.api -t VultStrike-api .
docker build -f Dockerfile.web -t VultStrike-web .
```

### Dokploy

For managed deployment with Traefik reverse proxy, see [docs/dokploy.md](docs/dokploy.md).

Uses `docker-compose.dokploy.yml` with production-grade configuration including health checks, restart policies, and TLS termination.

---

## 📚 Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design and component overview |
| [Deployment (Dokploy)](docs/dokploy.md) | Production deployment guide |
| [Multi-Server](docs/multi-server.md) | Running multiple CS2 server instances |
| [Cloudflare Setup](docs/cloudflare-setup.md) | DNS and proxy configuration |
| [Backup & Restore](docs/backups.md) | Database backup procedures |
| [Secret Rotation](docs/secret-rotation.md) | How to rotate credentials safely |
| [Requirements](docs/requirements.md) | Detailed system requirements |

---

## 🤝 Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

**Quick summary:**

1. Fork the repo and create a feature branch (`feat/your-feature`)
2. Make your changes with clear, focused commits
3. Run `pnpm lint && pnpm test && pnpm build` before pushing
4. Open a pull request with a clear description

**Good first contribution areas:**
- Matchmaking reliability and UX improvements
- API test coverage
- Frontend accessibility and performance
- Developer tooling and documentation
- CS2 orchestration observability

---

## 🔐 Security

**Do not open public issues for security vulnerabilities.**

Please report security issues privately via email: **me@palmiye.dev**

See [SECURITY.md](SECURITY.md) for our full security policy and disclosure process.

---

## 🗺️ Roadmap

See [ROADMAP.md](ROADMAP.md) for the full development roadmap including:
- Real-time queue updates via WebSockets
- Tournament brackets and events
- Season management with placements and resets
- Multi-region routing and failover
- Mobile companion app

---

## ⚖️ License

This project is licensed under the [MIT License](LICENSE).

---

## ⚠️ Disclaimer

VultStrike Arena can orchestrate CS2 game servers and process player/session data. For production deployments, ensure you implement proper:

- **Secret management** — Use a vault or environment-level secrets, never commit credentials
- **Rate limiting** — Protect queue joins, auth endpoints, and API routes
- **Monitoring** — Set up health checks, alerting, and structured logging
- **Backups** — Regular automated database backups with tested restore procedures
- **Compliance** — Review Steam's terms of service for game server operation

---

<p align="center">
  Built with ⚡ by the VultStrike community
</p>
