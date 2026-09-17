#!/usr/bin/env bash
set -euo pipefail

# Offsite backup uploader using Cloudinary "raw" uploads.
#
# Required env:
# - CLOUDINARY_CLOUD_NAME
# - CLOUDINARY_API_KEY
# - CLOUDINARY_API_SECRET
#
# Optional env:
# - CLOUDINARY_BACKUP_FOLDER (default: vultstrike/backups)
# - CLOUDINARY_BACKUP_PREFIX (default: vultstrike)
# - BACKUP_ENCRYPTION_PASSPHRASE (recommended; if set, encrypts before upload)
# - BACKUP_KEEP_LOCAL (default: true)
# - BACKUP_RETENTION_COUNT (default: 56) keep newest N backups in Cloudinary (best-effort)
#
# Notes:
# - Cloudinary is not ideal for DB backups, but it's a workable interim offsite target.
# - Strongly prefer encryption for offsite dumps.

: "${CLOUDINARY_CLOUD_NAME:?Missing CLOUDINARY_CLOUD_NAME}"
: "${CLOUDINARY_API_KEY:?Missing CLOUDINARY_API_KEY}"
: "${CLOUDINARY_API_SECRET:?Missing CLOUDINARY_API_SECRET}"

FOLDER="${CLOUDINARY_BACKUP_FOLDER:-vultstrike/backups}"
PREFIX="${CLOUDINARY_BACKUP_PREFIX:-vultstrike}"
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-true}"
RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-56}"

run_id="$(date -u +%Y%m%d_%H%M%S)"

local_dump="backups/${PREFIX}_${run_id}.sql.gz"
./scripts/backup-postgres.sh "${local_dump}"

upload_file="${local_dump}"
if [[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  encrypted="${local_dump}.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "${local_dump}" -out "${encrypted}"
  upload_file="${encrypted}"
  # Do not keep unencrypted dumps when encryption is enabled.
  rm -f "${local_dump}"
else
  echo "WARNING: BACKUP_ENCRYPTION_PASSPHRASE is not set. Uploading an unencrypted DB dump." >&2
fi

timestamp="$(date +%s)"
public_id="${PREFIX}_${run_id}"

# Cloudinary signature: sort params and sha1(param_string + api_secret)
sig_payload="folder=${FOLDER}&public_id=${public_id}&timestamp=${timestamp}"
signature="$(printf '%s%s' "${sig_payload}" "${CLOUDINARY_API_SECRET}" | openssl dgst -sha1 -hex | awk '{print $2}')"

curl -fsS -X POST "https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload" \
  -F "file=@${upload_file}" \
  -F "api_key=${CLOUDINARY_API_KEY}" \
  -F "timestamp=${timestamp}" \
  -F "folder=${FOLDER}" \
  -F "public_id=${public_id}" \
  -F "signature=${signature}" \
  >/dev/null

echo "Uploaded offsite backup: cloudinary://${CLOUDINARY_CLOUD_NAME}/${FOLDER}/${public_id}"

cleanup_old() {
  local keep_count="$1"
  if [[ -z "${keep_count}" ]]; then
    return 0
  fi
  if ! [[ "${keep_count}" =~ ^[0-9]+$ ]]; then
    echo "WARN: BACKUP_RETENTION_COUNT is not a number (${keep_count}); skipping retention cleanup" >&2
    return 0
  fi
  if [[ "${keep_count}" -le 0 ]]; then
    return 0
  fi

  local prefix="${FOLDER}/${PREFIX}_"
  local list_url="https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/raw"
  local url_prefix
  url_prefix="$(python3 - <<PY
import urllib.parse
print(urllib.parse.quote("${prefix}", safe=""))
PY
)"

  # Best-effort list (up to 500). We sort client-side by created_at to be safe.
  local json
  if ! json="$(curl -fsS -u "${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}" "${list_url}?type=upload&prefix=${url_prefix}&max_results=500" 2>/dev/null)"; then
    echo "WARN: failed to list Cloudinary backups for retention cleanup" >&2
    return 0
  fi

  local to_delete
  to_delete="$(printf '%s' "${json}" | python3 - "${keep_count}" <<'PY'
import json, sys
keep = int(sys.argv[1])
data = json.load(sys.stdin)
resources = data.get("resources") or []
items = []
for r in resources:
  pid = r.get("public_id")
  created = r.get("created_at") or ""
  if pid:
    items.append((created, pid))
items.sort(reverse=True)
for _, pid in items[keep:]:
  print(pid)
PY
)"

  if [[ -z "${to_delete}" ]]; then
    return 0
  fi

  local destroy_url="https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/destroy"
  local deleted=0
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    local ts sig_payload sig
    ts="$(date +%s)"
    sig_payload="invalidate=true&public_id=${pid}&timestamp=${ts}"
    sig="$(printf '%s%s' "${sig_payload}" "${CLOUDINARY_API_SECRET}" | openssl dgst -sha1 -hex | awk '{print $2}')"
    if curl -fsS -X POST "${destroy_url}" \
      -F "public_id=${pid}" \
      -F "api_key=${CLOUDINARY_API_KEY}" \
      -F "timestamp=${ts}" \
      -F "invalidate=true" \
      -F "signature=${sig}" \
      >/dev/null; then
      deleted=$((deleted + 1))
    fi
  done <<< "${to_delete}"

  if [[ "${deleted}" -gt 0 ]]; then
    echo "Retention cleanup: deleted ${deleted} old backups (kept newest ${keep_count})"
  fi
}

cleanup_old "${RETENTION_COUNT}"

if [[ "${KEEP_LOCAL}" != "true" ]]; then
  rm -f "${upload_file}"
fi
