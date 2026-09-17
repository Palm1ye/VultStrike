#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE=""
WORKSHOP_ID=""
MAP_NAME=""
MAP_ID=""
SKIP_DOWNLOAD="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/add-workshop-map.sh --mode 1v1|2v2|3v3 --workshop-id <id> --name "Map Name" [--id map_id] [--skip-download]

Examples:
  scripts/add-workshop-map.sh --mode 1v1 --workshop-id 3070897497 --name "Tirgo 1v1"
  scripts/add-workshop-map.sh --mode 2v2 --workshop-id 1234567890 --name "de_basalt" --id de_basalt
USAGE
}

slugify() {
  local input="$1"
  echo "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/_/g' \
    | sed -E 's/^_+|_+$//g' \
    | sed -E 's/_+/_/g'
}

prompt_mode() {
  echo "Select mode:"
  echo "1) 1v1"
  echo "2) 2v2"
  echo "3) 3v3"
  while true; do
    read -rp "Mode [1-3]: " choice
    case "$choice" in
      1) MODE="1v1"; return 0 ;;
      2) MODE="2v2"; return 0 ;;
      3) MODE="3v3"; return 0 ;;
      *) echo "Please enter 1, 2, or 3." ;;
    esac
  done
}

prompt_interactive() {
  prompt_mode
  while [[ -z "$WORKSHOP_ID" ]]; do
    read -rp "Workshop ID: " WORKSHOP_ID
  done
  while [[ -z "$MAP_NAME" ]]; do
    read -rp "Map name (display): " MAP_NAME
  done
  if [[ -z "$MAP_ID" ]]; then
    local suggested
    suggested="$(slugify "$MAP_NAME")"
    read -rp "Map id (enter to use '$suggested'): " MAP_ID
    MAP_ID="${MAP_ID:-$suggested}"
  fi
}

confirm_inputs() {
  echo "----------------------------------------------"
  echo "Mode:        $MODE"
  echo "Workshop ID: $WORKSHOP_ID"
  echo "Map name:    $MAP_NAME"
  echo "Map id:      $MAP_ID"
  echo "----------------------------------------------"
  read -rp "Continue? [y/N]: " confirm
  case "${confirm:-N}" in
    y|Y|yes|YES) return 0 ;;
    *) echo "Aborted."; exit 1 ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --workshop-id|--workshop)
      WORKSHOP_ID="${2:-}"
      shift 2
      ;;
    --name|--map-name)
      MAP_NAME="${2:-}"
      shift 2
      ;;
    --id|--map-id)
      MAP_ID="${2:-}"
      shift 2
      ;;
    --skip-download)
      SKIP_DOWNLOAD="true"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$MODE" && -z "$WORKSHOP_ID" && -z "$MAP_NAME" && -z "$MAP_ID" ]]; then
  prompt_interactive
else
  if [[ -z "$MODE" ]]; then
    read -rp "Mode (1v1/2v2/3v3): " MODE
  fi

  if [[ -z "$WORKSHOP_ID" ]]; then
    read -rp "Workshop ID: " WORKSHOP_ID
  fi

  if [[ -z "$MAP_NAME" ]]; then
    read -rp "Map name (display): " MAP_NAME
  fi

  if [[ -z "$MAP_ID" ]]; then
    MAP_ID="$(slugify "$MAP_NAME")"
  fi
fi

if [[ ! "$MODE" =~ ^(1v1|2v2|3v3)$ ]]; then
  echo "Invalid mode: $MODE" >&2
  exit 1
fi

if [[ ! "$WORKSHOP_ID" =~ ^[0-9]+$ ]]; then
  echo "Workshop ID must be numeric" >&2
  exit 1
fi

if [[ -z "$MAP_ID" ]]; then
  echo "Map id is empty after slugify" >&2
  exit 1
fi

confirm_inputs

case "$MODE" in
  1v1) MAX_PLAYERS=2 ;;
  2v2) MAX_PLAYERS=4 ;;
  3v3) MAX_PLAYERS=6 ;;
esac

echo "=============================================="
echo "Adding workshop map"
echo "Mode:        $MODE"
echo "Workshop ID: $WORKSHOP_ID"
echo "Map name:    $MAP_NAME"
echo "Map id:      $MAP_ID"
echo "=============================================="

python3 - "$ROOT_DIR" "$MODE" "$WORKSHOP_ID" "$MAP_NAME" "$MAP_ID" "$MAX_PLAYERS" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
mode = sys.argv[2]
workshop_id = sys.argv[3]
map_name = sys.argv[4]
map_id = sys.argv[5]
max_players = int(sys.argv[6])

def escape_ts(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")

maps_path = root / "apps/api/src/config/maps.config.ts"
text = maps_path.read_text()

# Parse existing entries (simple but reliable for our file layout)
entries = []
pattern = re.compile(
    r"\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'[^']*'\s*,\s*workshopId:\s*'([^']*)'",
    re.S
)
for match in pattern.finditer(text):
    entries.append({"id": match.group(1), "workshopId": match.group(2)})

by_id = {e["id"]: e for e in entries}
by_workshop = {e["workshopId"]: e for e in entries if e["workshopId"]}

resolved_map_id = map_id
existing_entry = None
if map_id in by_id:
    existing_entry = by_id[map_id]
elif workshop_id in by_workshop:
    existing_entry = by_workshop[workshop_id]

if existing_entry:
    resolved_map_id = existing_entry["id"]
    existing_workshop = existing_entry["workshopId"]
    if existing_workshop and existing_workshop != workshop_id:
        raise SystemExit(
            f"[maps.config] Map id '{resolved_map_id}' already exists with workshopId '{existing_workshop}'. Aborting."
        )
    if not existing_workshop and workshop_id:
        raise SystemExit(
            f"[maps.config] Map id '{resolved_map_id}' exists as a non-workshop map. Choose a different map id."
        )
    if resolved_map_id != map_id:
        print(f"[maps.config] Workshop ID already exists; using existing map id '{resolved_map_id}'")
    else:
        print("[maps.config] Entry already exists, skipping")
else:
    insert = (
        "  {\n"
        f"    id: '{escape_ts(map_id)}',\n"
        f"    name: '{escape_ts(map_name)}',\n"
        f"    workshopId: '{escape_ts(workshop_id)}',\n"
        f"    gameMode: '{escape_ts(mode)}',\n"
        f"    maxPlayers: {max_players},\n"
        f"    type: '{escape_ts(mode)}',\n"
        "    description: 'Workshop map',\n"
        "  },\n\n"
    )

    marker = "// Fallback maps for other modes"
    idx = text.find(marker)
    if idx != -1:
        text = text[:idx] + insert + text[idx:]
    else:
        # Insert before the closing array if marker is missing
        match = re.search(r"export const MAPS: MapConfig\[] = \[", text)
        if not match:
            raise SystemExit("[maps.config] Could not find MAPS array")
        closing = text.rfind("];\n")
        if closing == -1:
            raise SystemExit("[maps.config] Could not find end of MAPS array")
        text = text[:closing] + insert + text[closing:]

    maps_path.write_text(text)
    print("[maps.config] Added map entry")

service_path = root / "apps/api/src/modules/maps/maps.service.ts"
service_text = service_path.read_text()

def update_pool(text: str, mode: str, map_id: str) -> str:
    marker = f"this.mapPools.set('{mode}',"
    start = text.find(marker)
    if start == -1:
        raise SystemExit(f"[maps.service] Could not find map pool for {mode}")
    maps_idx = text.find("maps:", start)
    if maps_idx == -1:
        raise SystemExit(f"[maps.service] Could not find maps list for {mode}")
    open_idx = text.find("[", maps_idx)
    close_idx = text.find("]", open_idx)
    if open_idx == -1 or close_idx == -1:
        raise SystemExit(f"[maps.service] Could not parse maps array for {mode}")
    raw = text[open_idx + 1:close_idx].strip()
    items = [i.strip().strip("'\"") for i in raw.split(",") if i.strip()]
    if map_id not in items:
        items.append(map_id)
        new_list = ", ".join([f"'{i}'" for i in items])
        text = text[:open_idx + 1] + " " + new_list + text[close_idx:]
        return text
    return text

updated = update_pool(service_text, mode, resolved_map_id)
if updated != service_text:
    service_path.write_text(updated)
    print(f"[maps.service] Added {resolved_map_id} to {mode} pool")
else:
    print(f"[maps.service] {resolved_map_id} already in {mode} pool, skipping")

compose_path = root / "docker-compose.maps.yml"
compose_text = compose_path.read_text()

lines = compose_text.splitlines()
changed = False
for i, line in enumerate(lines):
    if "WORKSHOP_MAPS=" in line:
        prefix, rest = line.split("WORKSHOP_MAPS=", 1)
        ids = rest.strip().split()
        if workshop_id not in ids:
            ids.append(workshop_id)
            lines[i] = prefix + "WORKSHOP_MAPS=" + " ".join(ids)
            changed = True
        break

if changed:
    compose_path.write_text("\n".join(lines) + "\n")
    print("[docker-compose.maps] Added workshop ID")
else:
    print("[docker-compose.maps] Workshop ID already present, skipping")
PY

if [[ "$SKIP_DOWNLOAD" == "true" ]]; then
  echo "Skipping download step (--skip-download)"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed; cannot download workshop map automatically" >&2
  exit 1
fi

CACHE_HOST_DIR=$(python3 - "$ROOT_DIR" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
text = (root / "docker-compose.maps.yml").read_text()
m = re.search(r"-\s*([^:]+):/home/steam/Steam/steamapps/workshop", text)
print(m.group(1).strip() if m else "/home/steam/Steam/steamapps/workshop")
PY
)

mkdir -p "$CACHE_HOST_DIR"

STEAMCMD_IMAGE="${STEAMCMD_IMAGE:-steamcmd/steamcmd:latest}"

echo "Downloading workshop map $WORKSHOP_ID into cache: $CACHE_HOST_DIR"
docker run --rm \
  -v "$CACHE_HOST_DIR:/home/steam/Steam/steamapps/workshop" \
  "$STEAMCMD_IMAGE" \
  +force_install_dir /home/steam/Steam \
  +login anonymous \
  +workshop_download_item 730 "$WORKSHOP_ID" validate \
  +quit

if [[ -d "$CACHE_HOST_DIR/content/730/$WORKSHOP_ID" ]] && [[ -n "$(ls -A "$CACHE_HOST_DIR/content/730/$WORKSHOP_ID" 2>/dev/null)" ]]; then
  echo "Workshop map cached successfully: $WORKSHOP_ID"
else
  echo "Warning: Workshop map not found in cache after download: $WORKSHOP_ID" >&2
fi

echo "=============================================="
echo "Done. Remember to redeploy the API so map pools update in production."
echo "=============================================="
