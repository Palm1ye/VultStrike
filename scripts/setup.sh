#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/.logs"
PNPM_VERSION="10.24.0"
ENV_FILE_API="$PROJECT_ROOT/apps/api/.env"
ENV_FILE_WEB="$PROJECT_ROOT/apps/web/.env.local"

DB_NAME_DEFAULT="vultstrike"
DB_USER_DEFAULT="vultstrike"
DB_PASSWORD_DEFAULT=""
DB_HOST_DEFAULT="localhost"
DB_PORT_DEFAULT="5432"

DB_NAME="$DB_NAME_DEFAULT"
DB_USER="$DB_USER_DEFAULT"
DB_PASSWORD="$DB_PASSWORD_DEFAULT"
DB_HOST="$DB_HOST_DEFAULT"
DB_PORT="$DB_PORT_DEFAULT"

DATABASE_URL=""
API_PORT="4000"
NEXT_PUBLIC_API_BASE=""
ORCHESTRATOR_PUBLIC_HOST="${HOSTNAME:-localhost}"
API_PUBLIC_URL=""
WEB_PUBLIC_URL=""
JWT_SECRET=""
JWT_ISSUER="vultstrike"
JWT_AUDIENCE="vultstrike-web"
JWT_EXPIRES_IN="1h"
COOKIE_NAME="vultstrike_session"
COOKIE_SECRET=""
COOKIE_DOMAIN=""
COOKIE_SECURE="false"
MATCH_WEBHOOK_SECRET=""
CS2_GSLT=""
CS2_TARGET_WINS="13"

# Workshop Map Configuration (1v1 maps from Steam Workshop)
# Tirgo 1v1: 3070897497, Bluelines 1v1: 3070210382, Newage 1v1: 3070308285
CS2_MAP_POOL_ONE_V_ONE="tirgo,bluelines,newage"
CS2_MAP_POOL_TWO_V_TWO="de_dust2,de_mirage"
CS2_MAP_POOL_THREE_V_THREE="de_dust2,de_mirage"

MATCHMAKER_ENABLED="false"
REDIS_HOST="localhost"
REDIS_PORT="6379"
KAFKA_BROKERS="localhost:9092"

# CS2 Server Configuration
CS2_MOCK_MODE="true"
CS2_IMAGE="cm2network/cs2:latest"
GAME_SERVER_HOST=""

function info() {
  echo -e "\033[1;34m[vultstrike]\033[0m $1"
}

function random_hex() {
  local length="${1:-16}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$length"
  else
    python3 - <<PY
import secrets
print(secrets.token_hex($length))
PY
  fi
}

function load_existing_env() {
  if [[ -f "$ENV_FILE_API" ]]; then
    info "Loading existing environment config"
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE_API"
    set +a
  fi

  parse_database_url
}

function parse_database_url() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    return
  fi

  local sanitized="${DATABASE_URL#postgresql://}"
  local creds="${sanitized%%@*}"
  local host_and_db="${sanitized#*@}"
  local host_part="${host_and_db%%/*}"
  local db_part="${host_and_db#*/}"

  DB_USER_DEFAULT="${creds%%:*}"
  DB_PASSWORD_DEFAULT="${creds#*:}"
  DB_HOST_DEFAULT="${host_part%%:*}"
  DB_PORT_DEFAULT="${host_part##*:}"
  if [[ "$DB_PORT_DEFAULT" == "$host_part" ]]; then
    DB_PORT_DEFAULT="5432"
  fi
  DB_NAME_DEFAULT="${db_part%%\?*}"
}

function ensure_supported_os() {
  local os
  os="$(uname -s)"
  if [[ "$os" != "Linux" && "$os" != "Darwin" ]]; then
    echo "Unsupported OS: $os" >&2
    exit 1
  fi
}

function install_prereqs() {
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing build prerequisites via apt-get"
    sudo apt-get update -y
    sudo apt-get install -y curl ca-certificates build-essential openssl docker.io
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing build prerequisites via dnf"
    sudo dnf install -y curl ca-certificates gcc-c++ make openssl docker
  elif command -v brew >/dev/null 2>&1; then
    info "Homebrew detected; skipping OS prerequisites"
  else
    echo "Unsupported package manager. Install curl + build tools manually." >&2
    exit 1
  fi
}

function install_postgres() {
  if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" ]]; then
    info "Skipping PostgreSQL installation (remote host $DB_HOST)"
    return
  fi

  if command -v psql >/dev/null 2>&1 || [[ -x "/opt/homebrew/opt/postgresql@16/bin/psql" ]]; then
    info "PostgreSQL already installed"
  else
    if command -v apt-get >/dev/null 2>&1; then
      info "Installing PostgreSQL via apt-get"
      sudo apt-get install -y postgresql postgresql-contrib
    elif command -v dnf >/dev/null 2>&1; then
      info "Installing PostgreSQL via dnf"
      sudo dnf install -y postgresql-server postgresql-contrib
      if command -v postgresql-setup >/dev/null 2>&1; then
        sudo postgresql-setup --initdb --unit postgresql >/dev/null 2>&1 || true
      fi
    elif command -v brew >/dev/null 2>&1; then
      info "Installing PostgreSQL via Homebrew"
      brew install postgresql@16
      brew services start postgresql@16
    else
      echo "Unsupported package manager for PostgreSQL" >&2
      exit 1
    fi
  fi

  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable postgresql >/dev/null 2>&1 || true
    sudo systemctl start postgresql
  elif command -v service >/dev/null 2>&1; then
    sudo service postgresql start
  fi
}

function install_redis() {
  if command -v redis-server >/dev/null 2>&1; then
    info "Redis already installed"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    info "Installing Redis via apt-get"
    sudo apt-get install -y redis-server
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing Redis via dnf"
    sudo dnf install -y redis
  elif command -v brew >/dev/null 2>&1; then
    info "Installing Redis via Homebrew"
    brew install redis
    brew services start redis
  else
    echo "Unsupported package manager for Redis" >&2
    exit 1
  fi

  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable redis-server >/dev/null 2>&1 || true
    sudo systemctl start redis-server || true
  elif command -v service >/dev/null 2>&1; then
    sudo service redis-server start || true
  fi
}

function configure_database() {
  if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" ]]; then
    info "Skipping local database provisioning for remote host $DB_HOST"
    return
  fi

  local psql_cmd="psql"
  
  # Check if current user can access postgres; if not, force sudo -u postgres
  if ! psql postgres -c "select 1" >/dev/null 2>&1; then
      info "Current user cannot access Postgres. Switching to 'sudo -u postgres'..."
      psql_cmd="sudo -u postgres psql"
  fi

  info "Creating database role $DB_USER"
  $psql_cmd postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
    $psql_cmd postgres -c "CREATE USER \"${DB_USER}\" WITH PASSWORD '${DB_PASSWORD}';"

  info "Ensuring database $DB_NAME exists"
  $psql_cmd postgres -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
    $psql_cmd postgres -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

  $psql_cmd postgres -c "GRANT ALL PRIVILEGES ON DATABASE \"${DB_NAME}\" TO \"${DB_USER}\";" >/dev/null
  
  # Grant usage on schema public (fixes common permission issues on new Postgres versions)
  $psql_cmd "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO \"${DB_USER}\";" >/dev/null 2>&1 || true
}
function install_node() {
  if command -v node >/dev/null 2>&1 && node -v | grep -q "^v20"; then
    info "Node $(node -v) already installed"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    info "Installing Node.js 20.x from NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing Node.js 20.x via dnf"
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf install -y nodejs
  elif command -v brew >/dev/null 2>&1; then
    info "Installing Node.js 20 via Homebrew"
    brew install node@20
    brew link --overwrite --force node@20 || true
  fi
}

function ensure_pnpm() {
  info "Enabling Corepack and pnpm@$PNPM_VERSION"
  corepack enable || sudo npm install -g corepack
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
}

function prompt_env_configuration() {
  info "Configuring environment secrets"

  read -rp "API port [$API_PORT]: " api_port_input || true
  API_PORT="${api_port_input:-$API_PORT}"

  read -rp "API base for web (NEXT_PUBLIC_API_BASE) [http://localhost:${API_PORT}]: " api_base_input || true
  NEXT_PUBLIC_API_BASE="${api_base_input:-http://localhost:${API_PORT}}"

  read -rp "Public API URL for Steam callbacks [http://localhost:${API_PORT}]: " public_api_input || true
  API_PUBLIC_URL="${public_api_input:-http://localhost:${API_PORT}}"

  read -rp "Public web URL for redirects [http://localhost:3000]: " web_public_input || true
  WEB_PUBLIC_URL="${web_public_input:-http://localhost:3000}"

  read -rp "Public host/IP for connect strings [$ORCHESTRATOR_PUBLIC_HOST]: " host_input || true
  ORCHESTRATOR_PUBLIC_HOST="${host_input:-$ORCHESTRATOR_PUBLIC_HOST}"

  read -rp "CS2 GSLT (optional, leave blank to skip): " gslt_input || true
  CS2_GSLT="${gslt_input:-$CS2_GSLT}"

  read -rp "JWT secret [${JWT_SECRET:-generate}]: " jwt_input || true
  if [[ -z "$jwt_input" ]]; then
    JWT_SECRET="${JWT_SECRET:-$(random_hex 32)}"
    info "Generated JWT secret"
  else
    JWT_SECRET="$jwt_input"
  fi

  read -rp "Cookie secret [${COOKIE_SECRET:-generate}]: " cookie_input || true
  if [[ -z "$cookie_input" ]]; then
    COOKIE_SECRET="${COOKIE_SECRET:-$(random_hex 32)}"
    info "Generated cookie secret"
  else
    COOKIE_SECRET="$cookie_input"
  fi

  read -rp "Cookie domain (blank for default): " cookie_domain_input || true
  COOKIE_DOMAIN="$cookie_domain_input"

  read -rp "Cookie secure (true/false) [$COOKIE_SECURE]: " cookie_secure_input || true
  COOKIE_SECURE="${cookie_secure_input:-$COOKIE_SECURE}"

  read -rp "Match webhook secret [${MATCH_WEBHOOK_SECRET:-generate}]: " webhook_input || true
  if [[ -z "$webhook_input" ]]; then
    MATCH_WEBHOOK_SECRET="${MATCH_WEBHOOK_SECRET:-$(random_hex 32)}"
    info "Generated webhook secret"
  else
    MATCH_WEBHOOK_SECRET="$webhook_input"
  fi

  read -rp "Steam Web API Key (STEAM_API_KEY) [blank to skip]: " steam_api_key_input || true
  STEAM_API_KEY="$steam_api_key_input"

  read -rp "Map pool 1v1 (comma, workshop or map names) [$CS2_MAP_POOL_ONE_V_ONE]: " pool1 || true
  CS2_MAP_POOL_ONE_V_ONE="${pool1:-$CS2_MAP_POOL_ONE_V_ONE}"

  read -rp "Map pool 2v2 (comma) [$CS2_MAP_POOL_TWO_V_TWO]: " pool2 || true
  CS2_MAP_POOL_TWO_V_TWO="${pool2:-$CS2_MAP_POOL_TWO_V_TWO}"

  read -rp "Map pool 3v3 (comma) [$CS2_MAP_POOL_THREE_V_THREE]: " pool3 || true
  CS2_MAP_POOL_THREE_V_THREE="${pool3:-$CS2_MAP_POOL_THREE_V_THREE}"

  read -rp "CS2 Mock Mode (true/false) [$CS2_MOCK_MODE]: " mock_mode_input || true
  CS2_MOCK_MODE="${mock_mode_input:-$CS2_MOCK_MODE}"

  if [[ "$CS2_MOCK_MODE" == "false" ]]; then
    read -rp "CS2 Docker Image [$CS2_IMAGE]: " cs2_image_input || true
    CS2_IMAGE="${cs2_image_input:-$CS2_IMAGE}"
    
    read -rp "Game Server Public Host/IP [$GAME_SERVER_HOST]: " game_host_input || true
    GAME_SERVER_HOST="${game_host_input:-$GAME_SERVER_HOST}"
  fi

  read -rp "Database host [$DB_HOST_DEFAULT]: " host_input || true
  DB_HOST="${host_input:-$DB_HOST_DEFAULT}"

  read -rp "Database port [$DB_PORT_DEFAULT]: " port_input || true
  DB_PORT="${port_input:-$DB_PORT_DEFAULT}"

  read -rp "Database name [$DB_NAME_DEFAULT]: " name_input || true
  DB_NAME="${name_input:-$DB_NAME_DEFAULT}"

  read -rp "Database user [$DB_USER_DEFAULT]: " user_input || true
  DB_USER="${user_input:-$DB_USER_DEFAULT}"

  read -rsp "Database password [hidden, leave blank to generate]: " pass_input || true
  echo
  if [[ -z "$pass_input" ]]; then
    DB_PASSWORD="${DB_PASSWORD_DEFAULT:-$(random_hex 12)}"
    info "Generated database password"
  else
    DB_PASSWORD="$pass_input"
  fi

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"
}

function write_env_files() {
  info "Writing environment files"
  cat > "$ENV_FILE_API" <<EOF
DATABASE_URL="$DATABASE_URL"
PORT="$API_PORT"
API_PUBLIC_URL="$API_PUBLIC_URL"
WEB_PUBLIC_URL="$WEB_PUBLIC_URL"
JWT_SECRET="$JWT_SECRET"
JWT_ISSUER="$JWT_ISSUER"
JWT_AUDIENCE="$JWT_AUDIENCE"
JWT_EXPIRES_IN="$JWT_EXPIRES_IN"
COOKIE_NAME="$COOKIE_NAME"
COOKIE_SECRET="$COOKIE_SECRET"
COOKIE_DOMAIN="$COOKIE_DOMAIN"
COOKIE_SECURE="$COOKIE_SECURE"
MATCH_WEBHOOK_SECRET="$MATCH_WEBHOOK_SECRET"
MATCHMAKER_ENABLED="$MATCHMAKER_ENABLED"
REDIS_HOST="$REDIS_HOST"
REDIS_PORT="$REDIS_PORT"
KAFKA_BROKERS="$KAFKA_BROKERS"
ORCHESTRATOR_PUBLIC_HOST="$ORCHESTRATOR_PUBLIC_HOST"
CS2_GSLT="$CS2_GSLT"
CS2_TARGET_WINS="$CS2_TARGET_WINS"
CS2_MAP_POOL_ONE_V_ONE="$CS2_MAP_POOL_ONE_V_ONE"
CS2_MAP_POOL_TWO_V_TWO="$CS2_MAP_POOL_TWO_V_TWO"
CS2_MAP_POOL_THREE_V_THREE="$CS2_MAP_POOL_THREE_V_THREE"
STEAM_API_KEY="$STEAM_API_KEY"
CS2_MOCK_MODE="$CS2_MOCK_MODE"
CS2_IMAGE="$CS2_IMAGE"
GAME_SERVER_HOST="$GAME_SERVER_HOST"

# Workshop Map IDs (for reference)
# TIRGO_WORKSHOP_ID=3070897497
# BLUELINES_WORKSHOP_ID=3070210382
# NEWAGE_WORKSHOP_ID=3070308285
EOF

  local web_base
  web_base="${NEXT_PUBLIC_API_BASE:-http://localhost:${API_PORT}}"
  cat > "$ENV_FILE_WEB" <<EOF
NEXT_PUBLIC_API_BASE="$web_base"
EOF
  info "Web env written to $ENV_FILE_WEB"
}

function export_env() {
  if [[ -f "$ENV_FILE_API" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE_API"
    set +a
  fi
}

function install_dependencies() {
  info "Installing workspace dependencies"
  cd "$PROJECT_ROOT"
  PNPM_HOME=$(corepack prepare "pnpm@${PNPM_VERSION}" --activate 2>/dev/null || true)
  export PATH="${PNPM_HOME:-$HOME/.local/share/pnpm}:$PATH"
  pnpm install
}

function run_prisma() {
  info "Generating Prisma client"
  pnpm --filter api db:generate
  info "Applying Prisma migrations"
  pnpm --filter api db:migrate
  info "Seeding database"
  pnpm --filter api db:seed
  info "Applying Drizzle migrations"
  pnpm --filter api drizzle:migrate || true
}

function build_apps() {
  info "Building API and web apps"
  cd "$PROJECT_ROOT"
  pnpm --filter api build
  pnpm --filter web build
}

function start_services() {
  info "Starting services in background"
  mkdir -p "$LOG_DIR"
  cd "$PROJECT_ROOT"
  export_env
  nohup PORT="$API_PORT" pnpm --filter api start >"$LOG_DIR/api.log" 2>&1 &
  echo $! > "$LOG_DIR/api.pid"
  nohup pnpm --filter web start >"$LOG_DIR/web.log" 2>&1 &
  echo $! > "$LOG_DIR/web.pid"
  info "API running (PID $(cat "$LOG_DIR/api.pid"))"
  info "Web running (PID $(cat "$LOG_DIR/web.pid"))"
  info "Logs stored under $LOG_DIR"
}

ensure_supported_os
install_prereqs
install_node
ensure_pnpm
load_existing_env
prompt_env_configuration
install_postgres
install_redis
configure_database
write_env_files
export_env
install_dependencies
run_prisma
build_apps
start_services

info "VultStrike is live. Visit http://<server-ip>:3000 for the web UI."
