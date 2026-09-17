# Dokploy deployment (VultStrike)

This guide prepares VultStrike for Dokploy using Dockerfiles + a compose file.
It does **not** stop the current PM2 setup.

## Files added
- `Dockerfile.api`
- `Dockerfile.web`
- `docker-compose.dokploy.yml`

## Dokploy setup (recommended)
1) Create a new app in Dokploy and connect this GitHub repo.
2) Choose **Docker Compose** and point to `docker-compose.dokploy.yml`.
3) Set **environment variables** (see below).
4) For the web build, add a build arg:
   - `NEXT_PUBLIC_API_BASE=https://api.vultstrike.com`
5) Deploy.

## Required environment variables
These must be configured in Dokploy (do **not** commit secrets).
- `POSTGRES_PASSWORD`
- `API_PUBLIC_URL` (e.g. `https://api.vultstrike.com`)
- `WEB_PUBLIC_URL` (e.g. `https://vultstrike.com`)
- `WEBHOOK_URL` (optional; defaults to empty)
- `JWT_SECRET`
- `COOKIE_SECRET`
- `STEAM_API_KEY`
- `STEAM_AUTHKEY` (optional)
- `MATCH_WEBHOOK_SECRET`
- `GAME_SERVER_HOST` (public host/IP for CS2)
- `CS2_GSLT` (if using official servers)

## Optional environment variables
- `POSTGRES_USER` (default: `vultstrike`)
- `POSTGRES_DB` (default: `vultstrike`)
- `CS2_IMAGE` (default: `vultstrike-cs2:latest`)
- `CS2_MOCK_MODE` (default: `false`)
- `CS2_SHM_SIZE_MB` (default: `512`) increase `/dev/shm` for CS2 stability
- `CS2_NOFILE_LIMIT` (default: `1048576`) raise file descriptor limit for CS2
- `CS2_INIT` (default: `true`) enable Docker init for CS2 containers
- `CS2_STOP_TIMEOUT_SECONDS` (default: `15`) seconds to wait for CS2 to exit cleanly before force-kill
- `CS2_AUTO_SHUTDOWN` (default: `0`) set `1` to let the reporter plugin `quit` after match end (API still cleans up)
- `CS2_SHUTDOWN_DELAY` (default: `30`) plugin shutdown delay (seconds) when `CS2_AUTO_SHUTDOWN=1`
- `CS2_TARGET_WINS` (default: `13`)
- `REWARDS_ENABLED` (default: `false`) enable credits wallet + case opening
- `REWARDS_CREDITS_WIN` (default: `100`)
- `REWARDS_CREDITS_LOSS` (default: `40`)
- `REWARDS_CREDITS_DRAW` (default: `70`)
- `CS2_MAP_POOL_ONE_V_ONE`, `CS2_MAP_POOL_TWO_V_TWO`, `CS2_MAP_POOL_THREE_V_THREE`
- `CS2_PORT_RANGE` (default: `27015-27015`)
- `CS2_PORT_ALLOCATE_ATTEMPTS` (default: `4`) retry on host port bind collisions
- `CS2_HOST_DIR` (default: `/home/steam/Steam/steamapps/common/Counter-Strike Global Offensive`) CS2 install directory on host
- `CS2_STEAMCMD_DIR` (default: `/home/steam/steamcmd`) steamcmd directory on host
- `CS2_STEAM_RUNTIME_DIR` (default: `/home/steam/Steam`) Steam runtime/library root on host
- `CS2_STEAM_DOT_DIR` (default: `/home/steam/.steam`) host Steam dot directory used by updater container
- `CS2_STEAM_LIBRARY_CS2_DIR` (default: `/home/steam/Steam/steamapps/common/Counter-Strike Global Offensive`) preferred Steam-library CS2 path probe
- `CS2_LEGACY_STEAM_LIBRARY_CS2_DIR` (default: `/home/steam/Steam/steamapps/common/Counter-Strike Global Offensive`) legacy Steam-library CS2 path probe
- `CS2_LEGACY_HOST_DIR` (default: `/home/steam/cs2`) fallback CS2 host path probe
- `CS2_CONTAINER_CLEANUP_ENABLED` (default: `true`)
- `CS2_CONTAINER_CLEANUP_INTERVAL_MS` (default: `600000`)
- `CS2_CONTAINER_RETENTION_MINUTES` (default: `60`)
- `CS2_CONTAINER_STARTUP_GRACE_SECONDS` (default: `120`)
- `MATCH_TIMEOUT_ENABLED` (default: `true`)
- `MATCH_TIMEOUT_INTERVAL_MS` (default: `60000`)
- `MATCH_NO_CONNECT_TIMEOUT_MINUTES` (default: `15`)
- `QUEUE_TICKET_CLEANUP_ENABLED` (default: `true`)
- `QUEUE_TICKET_CLEANUP_INTERVAL_MS` (default: `600000`)
- `QUEUE_TICKET_RETENTION_MINUTES` (default: `180`)
- `ALERT_WEBHOOK_URL` (optional; Discord/Slack webhook URL for webhook failure alerts)
- `ALERT_THROTTLE_SECONDS` (default: `60`)
- `LOG_LEVEL`
- `COOKIE_DOMAIN` (default: `.vultstrike.com`)
- `COOKIE_SECURE` (default: `true`)

## Important notes
- **CS2 containers** are created by the API using Docker.  
  The API service mounts `/var/run/docker.sock` to control Docker on the host.
- The CS2 image `vultstrike-cs2:latest` must exist on the host.  
  Build it once with:
  `docker build -f services/cs2-image/Dockerfile -t vultstrike-cs2:latest .`
- The updater and match runtime bind host paths configured via `CS2_HOST_DIR`, `CS2_STEAMCMD_DIR`, `CS2_STEAM_RUNTIME_DIR`, and `CS2_STEAM_DOT_DIR`.  
  Ensure those paths exist on the host running Docker.

## Cutover plan
To avoid downtime, deploy in Dokploy first, then:
1) Verify `/auth/me`, `/community/feed`, matchmaking, and webhooks.
2) Update DNS/Proxy to point at Dokploy services.
3) Stop the old PM2 processes once new stack is stable.

## Troubleshooting

### Manual Redeploy (CLI)
If you need to redeploy without the Dokploy UI, the compose files live under:
- `/etc/dokploy/compose/<project>/code/docker-compose.dokploy.yml`
- `/etc/dokploy/compose/<project>/code/.env`

Example:
```bash
docker compose -p vultstrike-vultstrike-6pvzhh \
  --env-file /etc/dokploy/compose/vultstrike-vultstrike-6pvzhh/code/.env \
  -f /etc/dokploy/compose/vultstrike-vultstrike-6pvzhh/code/docker-compose.dokploy.yml \
  --project-directory /path/to/vultstrike \
  up -d --build --no-deps --force-recreate api web
```

### "No such container" during `--force-recreate`
Sometimes docker compose leaves a `Created` container and then fails with:
`Error response from daemon: No such container: <id>`.

Workaround:
1) Remove the `Created` container (it will show up in `docker ps -a`).
2) Recreate services individually:
```bash
docker rm <created_container_name>
docker compose ... up -d --no-deps --force-recreate api
docker compose ... up -d --no-deps --force-recreate web
```
