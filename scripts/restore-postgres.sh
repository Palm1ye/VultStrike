#!/usr/bin/env bash
set -euo pipefail

# Restore a Postgres dump produced by scripts/backup-postgres.sh.
# Safety: requires RESTORE_CONFIRM=YES to run.

if [[ "${RESTORE_CONFIRM:-}" != "YES" ]]; then
  echo "Refusing to restore without explicit confirmation." >&2
  echo "Set RESTORE_CONFIRM=YES and re-run if you are sure." >&2
  exit 1
fi

PROJECT="${DOKPLOY_COMPOSE_PROJECT:-vultstrike-vultstrike-6pvzhh}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

IN="${1:-}"
if [[ -z "${IN}" ]]; then
  echo "Usage: RESTORE_CONFIRM=YES $0 <backup.sql|backup.sql.gz>" >&2
  exit 1
fi

if [[ ! -f "${IN}" ]]; then
  echo "ERROR: Backup file not found: ${IN}" >&2
  exit 1
fi

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

echo "Restoring into container=${container_id} project=${PROJECT} db=${postgres_db} from ${IN}"

if [[ "${IN}" == *.gz ]]; then
  gzip -dc "${IN}" | docker exec -i "${container_id}" psql -U "${postgres_user}" -d "${postgres_db}"
else
  cat "${IN}" | docker exec -i "${container_id}" psql -U "${postgres_user}" -d "${postgres_db}"
fi

echo "Restore complete."

