#!/usr/bin/env bash
set -euo pipefail

# Simple Postgres backup helper for the Dokploy docker-compose project.
# Writes a gzipped SQL dump to backups/.

PROJECT="${DOKPLOY_COMPOSE_PROJECT:-vultstrike-vultstrike-6pvzhh}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

OUT="${1:-backups/vultstrike_$(date -u +%Y%m%d_%H%M%S).sql.gz}"

container_id="$(
  docker ps -q \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=${SERVICE}" \
  | head -n 1
)"

if [[ -z "${container_id}" ]]; then
  echo "ERROR: Could not find Postgres container for project=${PROJECT} service=${SERVICE}" >&2
  exit 1
fi

postgres_user="${POSTGRES_USER:-$(docker exec "${container_id}" sh -lc 'printf %s "${POSTGRES_USER:-}"' 2>/dev/null || true)}"
postgres_db="${POSTGRES_DB:-$(docker exec "${container_id}" sh -lc 'printf %s "${POSTGRES_DB:-}"' 2>/dev/null || true)}"

postgres_user="${postgres_user:-vultstrike}"
postgres_db="${postgres_db:-vultstrike}"

mkdir -p "$(dirname "${OUT}")"

echo "Backing up Postgres from container=${container_id} project=${PROJECT} db=${postgres_db} -> ${OUT}"
docker exec "${container_id}" pg_dump -U "${postgres_user}" --no-owner --no-privileges "${postgres_db}" | gzip -c > "${OUT}"
echo "Backup complete: ${OUT}"
