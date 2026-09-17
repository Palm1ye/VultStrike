# Secret Rotation Runbook

This is a pragmatic guide for rotating production secrets with minimal downtime.

## Inventory (Core Secrets)
- `JWT_SECRET`: signs user session tokens.
- `COOKIE_SECRET`: used by `@fastify/cookie` for signed cookies (we currently set an unsigned session cookie, but keep this secret treated as production).
- `MATCH_WEBHOOK_SECRET`: HMAC secret for CS2 -> API webhooks.
- `STEAM_API_KEY`, `STEAM_AUTHKEY`, `CS2_GSLT`: Steam integration.
- Any offsite backup credentials (Cloudinary / R2 / S3).

## General Rules
- Rotate secrets during low traffic.
- After rotation, verify with smoke tests and at least one real match.
- Assume rotation invalidates existing sessions unless explicitly designed otherwise.
- Never commit secrets to Git.

## Rotate `MATCH_WEBHOOK_SECRET` (Zero Downtime)
This secret is used by CS2 servers to sign webhook payloads. Old matches may still be running when you rotate.

We support a comma-separated list for verification:
- API verification accepts: `MATCH_WEBHOOK_SECRET="new_secret,old_secret"`
- New CS2 servers will use the first value (`new_secret`).

Steps:
1. Generate a new secret (random 32+ chars).
2. In Dokploy env: set `MATCH_WEBHOOK_SECRET="NEW,OLD"`.
3. Redeploy API (and optionally web).
4. Wait until all matches started with `OLD` finish.
5. Update env to `MATCH_WEBHOOK_SECRET="NEW"` and redeploy again.

## Rotate `JWT_SECRET` (Planned Session Reset)
Rotating `JWT_SECRET` invalidates all existing sessions immediately.

Steps:
1. Generate a new secret.
2. Update Dokploy env `JWT_SECRET`.
3. Redeploy API + web.
4. Expect users to sign in again.

## Rotate Steam Credentials (`STEAM_API_KEY`, `STEAM_AUTHKEY`, `CS2_GSLT`)
Steps:
1. Create or revoke keys on the Steam partner/API side.
2. Update Dokploy env vars.
3. Redeploy API.
4. Verify Steam login and server startup.

## Rotate Offsite Backup Credentials
Steps:
1. Create a new key/secret in the provider.
2. Update your cron job or Dokploy env.
3. Run one manual offsite backup and confirm it appears remotely.
4. Revoke the old key/secret.

