#!/bin/bash
# Workshop Map Pre-Cache Script
# Downloads workshop maps to a shared volume for reuse across containers

set -e

STEAMCMD_DIR="/home/steam/steamcmd"
CANDIDATE_BIN="${STEAMCMD_BIN:-}"
CACHE_DIR="${WORKSHOP_CACHE_DIR:-/home/steam/Steam/steamapps/workshop/content/730}"
STEAM_API_KEY="${STEAM_API_KEY:-}"

# List of workshop maps to pre-cache (space-separated workshop IDs)
WORKSHOP_MAPS="${WORKSHOP_MAPS:-3070897497 3070210382 3070308285}"

echo "=============================================="
echo "VultStrike Workshop Map Cache"
echo "=============================================="
echo "Cache directory: ${CACHE_DIR}"
echo "Maps to cache: ${WORKSHOP_MAPS}"
echo "=============================================="

# Resolve steamcmd binary
if [ -z "$CANDIDATE_BIN" ]; then
  if command -v steamcmd >/dev/null 2>&1; then
    CANDIDATE_BIN="steamcmd"
  elif [ -x "${STEAMCMD_DIR}/steamcmd.sh" ]; then
    CANDIDATE_BIN="${STEAMCMD_DIR}/steamcmd.sh"
  else
    echo "ERROR: steamcmd not found. Install it or use the steamcmd image." >&2
    exit 1
  fi
fi

# Create cache directory
mkdir -p "${CACHE_DIR}"
# Ensure permissions for steam user
chown -R steam:steam /home/steam/Steam || true

# Function to download a workshop map
download_workshop_map() {
  local workshop_id="$1"
  local map_dir="${CACHE_DIR}/${workshop_id}"

  if [ -d "$map_dir" ] && [ "$(ls -A "$map_dir")" ]; then
    echo "Map ${workshop_id} already cached, skipping"
    return 0
  fi

  echo "Downloading workshop map: ${workshop_id}"

  mkdir -p "$map_dir"

  # Download using steamcmd (force install dir to Steam library)
  ${CANDIDATE_BIN} \
    +force_install_dir /home/steam/Steam \
    +login anonymous \
    +workshop_download_item 730 ${workshop_id} validate \
    +quit

  DOWNLOADED="/home/steam/Steam/steamapps/workshop/content/730/${workshop_id}"
  if [ -d "$DOWNLOADED" ] && [ "$(ls -A "$DOWNLOADED")" ]; then
    echo "Map ${workshop_id} cached successfully"
  else
    echo "Warning: Failed to download map ${workshop_id}"
    rmdir "$map_dir" 2>/dev/null || true
    return 1
  fi
}

# Download all workshop maps
for map_id in $WORKSHOP_MAPS; do
  download_workshop_map "$map_id" || true
done

echo "=============================================="
echo "Workshop cache complete"
echo "=============================================="

# List cached maps
echo "Cached maps:"
for map_id in $WORKSHOP_MAPS; do
  if [ -d "${CACHE_DIR}/${map_id}" ]; then
    echo "  ✓ ${map_id}"
  else
    echo "  ✗ ${map_id} (failed)"
  fi
done
