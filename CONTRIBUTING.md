# Contributing to VultStrike

Thanks for considering a contribution.

## Development setup

1. Install prerequisites:
   - Node.js 20+
   - pnpm 8+
   - Docker + Docker Compose
2. Install dependencies:

```bash
corepack enable
pnpm install
```

3. Prepare local env files:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

4. Start local infra:

```bash
docker compose up -d
```

5. Run migrations:

```bash
pnpm exec drizzle-kit migrate --config=drizzle.config.ts
```

6. Start development servers:

```bash
pnpm dev:api
pnpm dev:web
```

## Branching and commits

- Branch naming:
  - `feat/<short-name>`
  - `fix/<short-name>`
  - `docs/<short-name>`
  - `chore/<short-name>`
- Prefer conventional commits, e.g.:
  - `feat(queue): add reconnect-safe queue state`
  - `fix(api): validate webhook signature before processing`

## Pull request checklist

Before opening a PR, run:

```bash
pnpm lint
pnpm test
pnpm build
```

PRs should include:

- Clear summary of what changed and why
- Screenshots/GIFs for UI changes
- Notes about migrations or breaking changes
- Security implications (if any)

## Security and secrets

- Never commit real secrets (`.env`, API keys, DB credentials)
- Use only `.env.example` files for defaults/placeholders
- If you accidentally commit a secret, open a security report immediately and rotate it

See also: `SECURITY.md` and `docs/secret-rotation.md`.

## Scope guidance

Great contribution areas:

- Matchmaking reliability and UX
- CS2 orchestration safety/observability
- API test coverage
- Frontend performance and accessibility
- Developer tooling and docs

## Code style

- Keep changes small and focused
- Avoid large unrelated refactors in the same PR
- Follow existing TypeScript/NestJS/Next.js patterns in each package

Thanks for helping improve VultStrike.
