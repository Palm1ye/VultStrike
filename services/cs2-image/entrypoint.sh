#!/bin/bash
set -e

# VultStrike CS2 Server Entrypoint
# CS2 is mounted from host at /home/steam/cs2-dedicated
# This script just sets up config and starts the server

CS2_DIR="/home/steam/cs2-dedicated"
GAME_DIR="${CS2_DIR}/game/csgo"
STEAM_APP_ID="730"

# Environment variables
MATCH_ID="${VS_MATCH_ID:-unknown}"
MAP="${VS_MAP:-de_dust2}"
LOBBY_CODE="${VS_LOBBY_CODE:-default}"
REGION="${VS_REGION:-eu-west}"
WEBHOOK_URL="${VS_WEBHOOK_URL:-}"
WEBHOOK_SECRET="${VS_WEBHOOK_SECRET:-}"
TARGET_WINS="${VS_TARGET_WINS:-13}"
WORKSHOP_ID="${VS_WORKSHOP_ID:-}"
STEAM_GSLT="${STEAM_GSLT:-}"
STEAM_AUTHKEY="${STEAM_AUTHKEY:-}"
PUBLIC_HOST="${VS_PUBLIC_HOST:-}"
PUBLIC_PORT="${VS_PUBLIC_PORT:-}"

# Treat VS_TARGET_WINS as the number of rounds needed to win (winlimit).
# Derive regulation max rounds (so a regulation tie is possible) and the halftime swap round.
if [[ ! "${TARGET_WINS}" =~ ^[0-9]+$ ]] || [ "${TARGET_WINS}" -lt 1 ]; then
  echo "WARN: invalid VS_TARGET_WINS='${TARGET_WINS}', defaulting to 13"
  TARGET_WINS="13"
fi

WIN_LIMIT="${TARGET_WINS}"
REGULATION_MAX_ROUNDS=$(( (WIN_LIMIT - 1) * 2 ))
if [ "${REGULATION_MAX_ROUNDS}" -lt 1 ]; then
  REGULATION_MAX_ROUNDS="1"
fi

SIDE_SWAP_ROUND=$(( REGULATION_MAX_ROUNDS / 2 ))
if [ "${SIDE_SWAP_ROUND}" -lt 1 ]; then
  SIDE_SWAP_ROUND="1"
fi

# Reporter plugin reads this to correctly map CT/T scores to ALPHA/BRAVO after side swaps.
export VS_SIDE_SWAP_ROUND="${VS_SIDE_SWAP_ROUND:-${SIDE_SWAP_ROUND}}"

echo "=============================================="
echo "VultStrike CS2 Server Starting"
echo "=============================================="
echo "Match ID: ${MATCH_ID}"
echo "Map: ${MAP}"
echo "Workshop ID: ${WORKSHOP_ID}"
echo "Lobby Code: ${LOBBY_CODE}"
echo "Region: ${REGION}"
echo "Public Endpoint: ${PUBLIC_HOST}:${PUBLIC_PORT}"
echo "Match Rules: winlimit=${WIN_LIMIT}, maxrounds=${REGULATION_MAX_ROUNDS}, sideSwapRound=${VS_SIDE_SWAP_ROUND}"
echo "=============================================="

# Steam App IDs
export SteamAppId="${STEAM_APP_ID}"
export SteamGameId="${STEAM_APP_ID}"
export SteamID="${STEAM_APP_ID}"

# Ensure steam_appid.txt exists where the server expects it.
for APPID_PATH in "${CS2_DIR}/steam_appid.txt" "${GAME_DIR}/steam_appid.txt" "${CS2_DIR}/game/bin/linuxsteamrt64/steam_appid.txt"; do
  if echo "${STEAM_APP_ID}" > "${APPID_PATH}" 2>/dev/null; then
    echo "Wrote steam_appid.txt to ${APPID_PATH}"
  else
    echo "WARN: could not write steam_appid.txt to ${APPID_PATH}"
  fi
done

# Verify CS2 is mounted
if [ ! -x "${CS2_DIR}/game/bin/linuxsteamrt64/cs2" ]; then
  echo "ERROR: CS2 not found at ${CS2_DIR}"
  echo "Make sure to mount CS2 installation to /home/steam/cs2-dedicated"
  exit 1
fi

echo "CS2 found at ${CS2_DIR}"

# Ensure steamapps/appmanifest_730.acf is visible under the CS2 root for Steam validation.
# Avoid creating an absolute symlink to /home/steam on the host-mounted CS2 path,
# because that becomes a broken link on the host and breaks steamcmd updates.
if [ -d "/home/steam/steamapps" ]; then
  if [ -L "${CS2_DIR}/steamapps" ]; then
    rm -f "${CS2_DIR}/steamapps" || true
  fi
  mkdir -p "${CS2_DIR}/steamapps"
  if [ -f "/home/steam/steamapps/appmanifest_${STEAM_APP_ID}.acf" ]; then
    cp -f "/home/steam/steamapps/appmanifest_${STEAM_APP_ID}.acf" "${CS2_DIR}/steamapps/appmanifest_${STEAM_APP_ID}.acf" || true
  fi
fi

# Ensure Steam client library is discoverable by the server
STEAMCLIENT_SRC="/home/steam/.steam/sdk64/steamclient.so"
STEAMCLIENT_DST="${CS2_DIR}/game/bin/linuxsteamrt64/steamclient.so"
if [ -f "${STEAMCLIENT_SRC}" ]; then
  if [ ! -f "${STEAMCLIENT_DST}" ]; then
    ln -sf "${STEAMCLIENT_SRC}" "${STEAMCLIENT_DST}"
    echo "Linked steamclient.so into ${STEAMCLIENT_DST}"
  fi
else
  echo "WARN: steamclient.so not found at ${STEAMCLIENT_SRC}"
fi

# Best-effort validation: ensure CS2 app manifest exists
if [ ! -f "${CS2_DIR}/steamapps/appmanifest_${STEAM_APP_ID}.acf" ]; then
  echo "WARN: appmanifest_${STEAM_APP_ID}.acf not found under ${CS2_DIR}/steamapps."
  echo "      If a different AppID is installed, CS2 clients may show 'AppID invalid' on connect."
fi

# Copy our plugin to the mounted CS2 installation
PLUGIN_DIR="${GAME_DIR}/addons/counterstrikesharp/plugins/VultStrikeReporter"
mkdir -p "${PLUGIN_DIR}"
if [ -f /opt/vultstrike/VultStrikeReporter.dll ]; then
  cp /opt/vultstrike/VultStrikeReporter.dll "${PLUGIN_DIR}/"
  echo "Plugin copied to ${PLUGIN_DIR}"
fi

# Validate CounterStrikeSharp runtime on the mounted host installation.
# The image only ships the VultStrike plugin DLL; Metamod + CounterStrikeSharp
# loader/runtime must exist on the mounted CS2 files or the plugin will never load.
MM_S2_DIR="${GAME_DIR}/addons/metamod"
CSS_DIR="${GAME_DIR}/addons/counterstrikesharp"
GAMEINFO="${GAME_DIR}/gameinfo.gi"
if [ ! -d "${MM_S2_DIR}" ] || [ ! -d "${CSS_DIR}" ]; then
  echo "ERROR: Metamod or CounterStrikeSharp runtime is missing from ${GAME_DIR}/addons"
  echo "       Expected ${MM_S2_DIR} and ${CSS_DIR} to exist on the mounted CS2 installation."
  echo "       Current addons contents:"
  ls -la "${GAME_DIR}/addons" 2>/dev/null || true
  exit 1
fi
if [ ! -f "${GAMEINFO}" ] || ! grep -q "csgo/addons/metamod" "${GAMEINFO}"; then
  echo "ERROR: gameinfo.gi is not configured for Metamod. CounterStrikeSharp cannot load."
  echo "       Please install Metamod:Source and CounterStrikeSharp into the mounted CS2 host files."
  exit 1
fi

# Create server configuration
mkdir -p "${GAME_DIR}/cfg"

write_autoexec() {
  local extra_commands="${1:-}"

  cat > "${GAME_DIR}/cfg/autoexec.cfg" <<AUTOEXEC
// VultStrike Match Autoexec
// Dynamic match rules for this match container

// Game rules (dynamic - derived from VS_TARGET_WINS)
mp_halftime 1
mp_halftime_duration 15
mp_maxrounds ${REGULATION_MAX_ROUNDS}
mp_winlimit ${WIN_LIMIT}
mp_match_can_clinch 1
mp_overtime_enable 1
mp_overtime_maxrounds 6
mp_match_end_restart 0

// Round settings
mp_freezetime 10
mp_roundtime 1.92
mp_roundtime_defuse 1.92
mp_buytime 15
mp_c4timer 45
mp_round_restart_delay 5
mp_win_panel_display_time 3
mp_autokick 0
mp_friendlyfire 1
mp_tkpunish 0
mp_do_warmup_period 1
mp_join_grace_time 30
mp_startmoney 800
mp_maxmoney 16000
mp_afterroundmoney 0
mp_playercashawards 1
mp_teamcashawards 1

// Cash
cash_player_killed_enemy_default 300
cash_player_killed_enemy_factor 1
cash_player_killed_teammate -300
cash_player_bomb_planted 300
cash_player_bomb_defused 300
cash_team_elimination_bomb_map 3250
cash_team_loser_bonus 1400
cash_team_loser_bonus_consecutive_rounds 500
cash_team_terrorist_win_bomb 3500
cash_team_win_by_defusing_bomb 3500
cash_team_planted_bomb_but_defused 800
cash_player_get_killed 0
cash_player_respawn_amount 0

// Grenades
ammo_grenade_limit_default 1
ammo_grenade_limit_flashbang 2
ammo_grenade_limit_total 4
mp_molotovusedelay 0

// Drop / death
mp_death_drop_gun 1
mp_death_drop_grenade 2
mp_death_drop_defuser 1

// Spectator
mp_forcecamera 1
spec_freeze_time 2.0
spec_freeze_panel_extended_time 0
spec_freeze_time_lock 2
spec_freeze_deathanim_time 0

// Server behavior
sv_competitive_minspec 1
sv_alltalk 0
sv_deadtalk 0
sv_full_alltalk 0
sv_voiceenable 1
sv_damage_print_enable 1
sv_kick_players_with_cooldown 0
sv_kick_ban_duration 0
sv_allow_wait_command 0
sv_alternateticks 0
sv_forcepreload 0
sv_gameinstructor_disable 1
sv_ignoregrenaderadio 0
sv_steamgroup_exclusive 0
mp_solid_teammates 1
mp_weapons_allow_zeus 1
mp_weapons_allow_map_placed 1
mp_free_armor 0
mp_defuser_allocation 0
mp_playerid 0
ff_damage_reduction_bullets 0.33
ff_damage_reduction_grenade 0.85
ff_damage_reduction_other 0.4
ff_damage_reduction_grenade_self 1

// Anti-cheat
sv_cheats 0
sv_pure 1
sv_pure_kick_clients 1
sv_pure_trace 0
sv_consistency 0

// Managed by VultStrikeReporter plugin
// bot_quota / bot_quota_mode
// mp_limitteams
// mp_warmuptime
// mp_respawn_on_death_ct / mp_respawn_on_death_t

${extra_commands}

say "> VultStrike CS2 match config loaded <"
AUTOEXEC
}

cat > "${GAME_DIR}/cfg/server.cfg" << SERVERCFG
// VultStrike Server Configuration
hostname "VultStrike Match"
sv_password "${LOBBY_CODE}"
sv_lan 0
sv_cheats 0
sv_allow_votes 0
sv_pausable 1

// Logging
log on
sv_log_onefile 0
sv_logbans 1
sv_logecho 1
sv_logfile 1
sv_logflush 0
sv_logsdir logs
sv_logdetail 3

// Network
sv_maxrate 0
sv_minrate 20000
sv_mincmdrate 30

// FastDL - Clients can download workshop maps from our HTTP server
sv_downloadurl "http://87.98.241.215:8888/cs2/workshop/content/730/"
sv_allowdownload 1
sv_allowupload 0

// Workshop broadcast - tell clients which workshop maps server uses
sv_broadcast_ugc_downloads 1
SERVERCFG

echo "Server config created"

# Determine game mode settings
GAME_MODE="1"
GAME_TYPE="0"
MAP_GROUP="mg_active"

# Build command line arguments
# In host-network mode the server must bind to the dynamically allocated port
# rather than the hardcoded 27015.  VS_PUBLIC_PORT is passed by the API.
SERVER_PORT="${PUBLIC_PORT:-27015}"
ARGS="-dedicated -ip 0.0.0.0 -port ${SERVER_PORT}"
ARGS="$ARGS -steamappid ${STEAM_APP_ID}"
ARGS="$ARGS +game_type ${GAME_TYPE} +game_mode ${GAME_MODE}"
ARGS="$ARGS +mapgroup ${MAP_GROUP}"
ARGS="$ARGS -maxplayers 12"
ARGS="$ARGS +exec server.cfg +exec autoexec.cfg"
# Execute autoexec explicitly. In practice the dedicated server is not reliably
# loading it for this setup, which leaves workshop map switching and match rules unapplied.
ARGS="$ARGS -console -usercon -nobreakpad"

# Add GSLT if provided
if [ -n "${STEAM_GSLT}" ]; then
  ARGS="$ARGS +sv_setsteamaccount ${STEAM_GSLT}"
  echo "Using GSLT for public server"
fi

# Add Steam Web API key if provided
if [ -n "${STEAM_AUTHKEY}" ]; then
  ARGS="$ARGS -authkey ${STEAM_AUTHKEY}"
fi

# Add region
ARGS="$ARGS +sv_region 255"

# Add public address for proper Steam server advertisement (when behind NAT/Docker)
if [ -n "${PUBLIC_HOST}" ] && [ -n "${PUBLIC_PORT}" ]; then
  ARGS="$ARGS -net_public_addr ${PUBLIC_HOST}:${PUBLIC_PORT}"
  echo "Public address set: ${PUBLIC_HOST}:${PUBLIC_PORT}"
fi

# Handle map - workshop or standard
if [ -n "$WORKSHOP_ID" ]; then
    WORKSHOP_DIR_PRIMARY="${CS2_DIR}/steamapps/workshop/content/730/${WORKSHOP_ID}"
    WORKSHOP_DIR_STEAM="/home/steam/Steam/steamapps/workshop/content/730/${WORKSHOP_ID}"
    WORKSHOP_VPK_PRIMARY="${WORKSHOP_DIR_PRIMARY}/${WORKSHOP_ID}.vpk"
    WORKSHOP_VPK_STEAM="${WORKSHOP_DIR_STEAM}/${WORKSHOP_ID}.vpk"
    WORKSHOP_VPK_PRIMARY_DIR="${WORKSHOP_DIR_PRIMARY}/${WORKSHOP_ID}_dir.vpk"
    WORKSHOP_VPK_STEAM_DIR="${WORKSHOP_DIR_STEAM}/${WORKSHOP_ID}_dir.vpk"
    WORKSHOP_VPK=""
  
    # Check if workshop map is already downloaded on host
    if [ -f "$WORKSHOP_VPK_PRIMARY_DIR" ]; then
      WORKSHOP_VPK="$WORKSHOP_VPK_PRIMARY_DIR"
    elif [ -f "$WORKSHOP_VPK_STEAM_DIR" ]; then
      WORKSHOP_VPK="$WORKSHOP_VPK_STEAM_DIR"
    elif [ -f "$WORKSHOP_VPK_PRIMARY" ]; then
      WORKSHOP_VPK="$WORKSHOP_VPK_PRIMARY"
    elif [ -f "$WORKSHOP_VPK_STEAM" ]; then
      WORKSHOP_VPK="$WORKSHOP_VPK_STEAM"
    else
      # Fallback: pick the first VPK in the workshop folder
      if [ -d "$WORKSHOP_DIR_PRIMARY" ]; then
        WORKSHOP_VPK="$(ls "$WORKSHOP_DIR_PRIMARY"/*.vpk 2>/dev/null | head -1)"
      elif [ -d "$WORKSHOP_DIR_STEAM" ]; then
        WORKSHOP_VPK="$(ls "$WORKSHOP_DIR_STEAM"/*.vpk 2>/dev/null | head -1)"
      fi
    fi

    if [ -n "$WORKSHOP_VPK" ]; then
      echo "Workshop map VPK found: ${WORKSHOP_VPK}"
    
    # Get the actual map name from the VPK
    MAP_NAME=$(strings "$WORKSHOP_VPK" 2>/dev/null | grep -oE "^(de|cs|ar)_[a-z0-9_]+" | head -1)
    if [ -z "$MAP_NAME" ]; then
      # Try to get from publish_data.txt
      if [ -f "${WORKSHOP_DIR_PRIMARY}/publish_data.txt" ]; then
        PUBLISH_DATA="${WORKSHOP_DIR_PRIMARY}/publish_data.txt"
      else
        PUBLISH_DATA="${WORKSHOP_DIR_STEAM}/publish_data.txt"
      fi
      if [ -f "$PUBLISH_DATA" ]; then
        MAP_NAME=$(grep -oE "(de|cs|ar)_[a-z0-9_]+" "$PUBLISH_DATA" | head -1)
      fi
    fi
    
    # Fallback map names based on workshop ID
    if [ -z "$MAP_NAME" ]; then
      case "$WORKSHOP_ID" in
        3070897497) MAP_NAME="de_tirgo" ;;
        3070210382) MAP_NAME="de_bluelines" ;;
        3070308285) MAP_NAME="de_newage" ;;
        *) MAP_NAME="de_workshop" ;;
      esac
    fi
    echo "Detected map name: ${MAP_NAME}"
    
    # Create symlinks so CS2 can find the VPK parts as addons
    WORKSHOP_DIR="$(dirname "$WORKSHOP_VPK")"
    if [ -d "$WORKSHOP_DIR" ]; then
      for part in "$WORKSHOP_DIR"/*.vpk; do
        [ -e "$part" ] || continue
        base="$(basename "$part")"
        if [ "$base" = "${WORKSHOP_ID}_dir.vpk" ]; then
          ln -sf "$part" "${GAME_DIR}/workshop_${WORKSHOP_ID}.vpk"
          ln -sf "$part" "${GAME_DIR}/workshop_${WORKSHOP_ID}_dir.vpk"
        else
          suffix="${base#${WORKSHOP_ID}_}"
          ln -sf "$part" "${GAME_DIR}/workshop_${WORKSHOP_ID}_${suffix}"
        fi
      done
      echo "Created VPK symlinks in ${GAME_DIR}"
    fi
    
    # Modify gameinfo.gi to include the workshop VPK in search paths
    GAMEINFO="${GAME_DIR}/gameinfo.gi"
    if [ -f "$GAMEINFO" ] && ! grep -q "workshop_${WORKSHOP_ID}.vpk" "$GAMEINFO"; then
      sed -i "/Game[[:space:]]*csgo\/addons\/metamod/a\                        Game    csgo/workshop_${WORKSHOP_ID}.vpk" "$GAMEINFO"
      echo "Added workshop VPK to gameinfo.gi search paths"
    fi
    
    # Add workshop config so clients know where to download
    echo "sv_workshop_allow_other_maps 1" >> "${GAME_DIR}/cfg/server.cfg"
    
    # Create autoexec.cfg that will switch to workshop map after server starts
    # This allows Steam connection to complete first, then load workshop map
    write_autoexec "// Wait for server to initialize, then switch to workshop map
  echo \"Switching to workshop map ${WORKSHOP_ID}...\"
  host_workshop_map ${WORKSHOP_ID}"
    echo "Created autoexec.cfg to switch to workshop map after startup"
    
    # Start with de_dust2, autoexec will switch to workshop map
    ARGS="$ARGS +map de_dust2"
    echo "Starting with de_dust2, will switch to workshop map: ${WORKSHOP_ID}"
    echo ""
    echo "NOTE: Clients will auto-download workshop map from Steam"
  else
    # Workshop VPK not found locally - try host_workshop_map
    write_autoexec "// Workshop map will be loaded directly from launch parameters."
    ARGS="$ARGS +host_workshop_map ${WORKSHOP_ID}"
    echo "Workshop VPK not found locally, CS2 will download from Steam"
    echo "Starting with workshop map ID: ${WORKSHOP_ID}"
  fi
else
  # Standard map
  ARGS="$ARGS +map ${MAP}"
  echo "Starting with map: ${MAP}"
  write_autoexec "// No workshop map configured for this match."
fi

# Set environment variables for the plugin
export VS_MATCH_ID="${MATCH_ID}"
export VS_WEBHOOK_URL="${WEBHOOK_URL}"
export VS_WEBHOOK_SECRET="${WEBHOOK_SECRET}"
export VS_TARGET_WINS="${TARGET_WINS}"
export VS_SIDE_SWAP_ROUND="${VS_SIDE_SWAP_ROUND}"
# Preserve Docker-injected variables that the plugin also needs.
# VS_API_BASE is set by the API's DockerService; re-export so it survives exec.
export VS_API_BASE="${VS_API_BASE:-}"
export VS_EXPECTED_PLAYERS="${VS_EXPECTED_PLAYERS:-}"
export VS_ALLOW_BOTS="${VS_ALLOW_BOTS:-0}"
export VS_BOT_QUOTA="${VS_BOT_QUOTA:-}"
export VS_BOT_TEAM="${VS_BOT_TEAM:-}"
export VS_AUTO_SHUTDOWN="${VS_AUTO_SHUTDOWN:-0}"

# Export runtime home
export HOME=/home/steam

# Set library path for Steam runtime
export LD_LIBRARY_PATH="${CS2_DIR}/game/bin/linuxsteamrt64:${LD_LIBRARY_PATH}"

echo "Starting CS2 server..."
echo "Command: ./cs2 ${ARGS}"

cd "${CS2_DIR}/game/bin/linuxsteamrt64"
exec ./cs2 ${ARGS}
