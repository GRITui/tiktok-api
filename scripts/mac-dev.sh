#!/usr/bin/env bash
# Run the whole OMS on this Mac: Postgres + Redis (Docker), API, worker, web app and a Cloudflare tunnel
# so TikTok can reach the OAuth callback and webhooks. Ctrl-C stops everything.
#
#   scripts/mac-dev.sh                         # quick tunnel (random *.trycloudflare.com URL)
#   scripts/mac-dev.sh --tunnel-name oms --public-url https://oms.example.com   # named tunnel, fixed URL
#   scripts/mac-dev.sh --no-tunnel             # local only
#   scripts/mac-dev.sh --create-admin you@example.com                       # also create an admin login
#
# Written for macOS's bash 3.2; also runs on Linux.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TUNNEL=quick
TUNNEL_NAME=""
PUBLIC_URL=""
ADMIN_EMAIL=""
SKIP_DOCKER="${SKIP_DOCKER:-0}"

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-tunnel) TUNNEL=none ;;
    --tunnel-name) TUNNEL=named; TUNNEL_NAME="${2:?--tunnel-name needs a value}"; shift ;;
    --public-url) PUBLIC_URL="${2:?--public-url needs a value}"; shift ;;
    --create-admin) ADMIN_EMAIL="${2:?--create-admin needs an email}"; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
  shift
done
if [ "$TUNNEL" = named ] && [ -z "$PUBLIC_URL" ]; then
  echo "--tunnel-name needs --public-url (the hostname you routed to the tunnel)" >&2; exit 1
fi

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ── .env helpers ────────────────────────────────────────────────────────────
env_get() { # KEY → value ('' if missing)
  [ -f .env ] || { echo ""; return; }
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true
}
env_set() { # KEY VALUE (replaces or appends; perl -pi works the same on macOS and Linux)
  if grep -qE "^$1=" .env; then
    KEY="$1" VAL="$2" perl -pi -e 's/^\Q$ENV{KEY}\E=.*$/$ENV{KEY}=$ENV{VAL}/' .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

# ── 1. Prerequisites ────────────────────────────────────────────────────────
bold "1/7 Checking tools"
need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found. Install it with: $2"; }
need node "brew install node@22"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node $NODE_MAJOR found; need 22+. brew install node@22"
if ! command -v pnpm >/dev/null 2>&1; then
  info "pnpm missing, enabling it via corepack"
  corepack enable || die "Could not enable pnpm. Run: corepack enable"
fi
need openssl "brew install openssl"
need perl "xcode-select --install"
need curl "brew install curl"
[ "$SKIP_DOCKER" = 1 ] || need docker "brew install --cask docker (then open Docker Desktop once)"
[ "$TUNNEL" = none ] || need cloudflared "brew install cloudflared"
info "ok"

# ── 2. .env ─────────────────────────────────────────────────────────────────
bold "2/7 Preparing .env"
if [ ! -f .env ]; then cp .env.example .env; info "created .env from .env.example"; fi
if [ -z "$(env_get TOKEN_ENCRYPTION_KEY)" ]; then
  env_set TOKEN_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  info "generated TOKEN_ENCRYPTION_KEY (keep it: tokens saved with it can't be read without it)"
fi
PLACEHOLDER_CREDS=0
for k in TTS_APP_KEY TTS_APP_SECRET; do
  if [ -z "$(env_get "$k")" ] || [ "$(env_get "$k")" = placeholder ]; then
    env_set "$k" placeholder; PLACEHOLDER_CREDS=1
  fi
done
[ "$PLACEHOLDER_CREDS" = 0 ] || info "TikTok credentials not set yet: using placeholders (UI works, shop connect won't)"
API_PORT="$(env_get API_PORT)"; API_PORT="${API_PORT:-3000}"
mkdir -p var/logs

# ── 3. Dependencies ─────────────────────────────────────────────────────────
bold "3/7 Installing dependencies"
pnpm install --frozen-lockfile >var/logs/install.log 2>&1 || { tail -n 20 var/logs/install.log; die "pnpm install failed (full log: var/logs/install.log)"; }
info "ok"

# ── 4. Postgres + Redis ─────────────────────────────────────────────────────
bold "4/7 Starting Postgres and Redis"
if [ "$SKIP_DOCKER" = 1 ]; then
  info "SKIP_DOCKER=1: using the DATABASE_URL / REDIS_URL from .env as-is"
else
  docker info >/dev/null 2>&1 || die "Docker is not running. Open Docker Desktop and retry."
  docker compose up -d >/dev/null
  printf '  waiting for Postgres'
  i=0
  until docker compose exec -T postgres pg_isready -U oms >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -lt 60 ] || die "Postgres did not become ready (docker compose logs postgres)"
    printf '.'; sleep 1
  done
  echo " ready"
fi

# ── 5. Database schema + admin ──────────────────────────────────────────────
bold "5/7 Applying database migrations"
pnpm db:migrate >var/logs/migrate.log 2>&1 || { cat var/logs/migrate.log; die "migrations failed"; }
info "ok"
if [ -n "$ADMIN_EMAIL" ]; then
  printf '  password for %s: ' "$ADMIN_EMAIL"; read -r -s ADMIN_PASSWORD; echo
  (cd apps/api && pnpm exec tsx --conditions=@oms/source --env-file=../../.env \
    src/cli/createUser.ts --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" --role admin) \
    || die "could not create admin (does it already exist?)"
fi

# ── Process management ──────────────────────────────────────────────────────
PIDS=""
cleanup() {
  trap - INT TERM EXIT
  echo; bold "Stopping…"
  for p in $PIDS; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  [ "$SKIP_DOCKER" = 1 ] || info "Postgres/Redis keep running in Docker (stop with: docker compose stop)"
}
trap cleanup INT TERM EXIT
start() { # NAME CMD… → background, log to var/logs/NAME.log
  local name="$1"; shift
  "$@" >"var/logs/$name.log" 2>&1 &
  PIDS="$PIDS $!"
}

# ── 6. Tunnel ───────────────────────────────────────────────────────────────
bold "6/7 Starting tunnel"
case "$TUNNEL" in
  quick)
    start tunnel cloudflared tunnel --no-autoupdate --url "http://localhost:$API_PORT"
    printf '  waiting for trycloudflare URL'
    i=0
    while [ -z "$PUBLIC_URL" ]; do
      PUBLIC_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' var/logs/tunnel.log | head -n 1 || true)"
      [ -n "$PUBLIC_URL" ] && break
      i=$((i + 1)); [ "$i" -lt 45 ] || { echo; tail -n 20 var/logs/tunnel.log; die "no tunnel URL after 45s"; }
      printf '.'; sleep 1
    done
    echo " $PUBLIC_URL" ;;
  named)
    start tunnel cloudflared tunnel --no-autoupdate run --url "http://localhost:$API_PORT" "$TUNNEL_NAME"
    info "named tunnel '$TUNNEL_NAME' → $PUBLIC_URL" ;;
  none) info "skipped (--no-tunnel): TikTok cannot reach this Mac" ;;
esac
PUBLIC_URL="${PUBLIC_URL%/}"
if [ -n "$PUBLIC_URL" ]; then
  env_set WEBHOOK_PUBLIC_URL "$PUBLIC_URL/webhooks/tiktok"
fi

# ── 7. API, worker, web ─────────────────────────────────────────────────────
bold "7/7 Starting API, worker and web app"
start api pnpm dev:api
start worker pnpm dev:worker
start web pnpm --filter @oms/web dev
printf '  waiting for API'
i=0
until curl -fsS "http://localhost:$API_PORT/healthz" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -lt 60 ] || { echo; tail -n 30 var/logs/api.log; die "API did not start (var/logs/api.log)"; }
  printf '.'; sleep 1
done
echo " up"

# Keep the Mac awake while serving (macOS only).
if command -v caffeinate >/dev/null 2>&1; then caffeinate -dims -w $$ & PIDS="$PIDS $!"; fi

TUNNEL_OK="n/a"
if [ -n "$PUBLIC_URL" ]; then
  TUNNEL_OK="no (DNS can take ~30s; check var/logs/tunnel.log)"
  i=0
  while [ "$i" -lt 20 ]; do
    if curl -fsS "$PUBLIC_URL/healthz" >/dev/null 2>&1; then TUNNEL_OK="yes"; break; fi
    i=$((i + 1)); sleep 2
  done
fi

echo
bold "OMS is running"
info "Web app:        http://localhost:5173"
info "API:            http://localhost:$API_PORT  (healthz ok)"
if [ -n "$PUBLIC_URL" ]; then
  info "Public URL:     $PUBLIC_URL  (reachable: $TUNNEL_OK)"
  echo
  bold "Paste into TikTok Partner Center (App → settings):"
  info "Redirect URL:   $PUBLIC_URL/auth/tiktok/callback"
  info "Webhook URL:    $PUBLIC_URL/webhooks/tiktok"
  [ "$TUNNEL" = quick ] && info "(quick-tunnel URLs change on every restart: update both fields each time)"
fi
[ "$PLACEHOLDER_CREDS" = 0 ] || info "Next: put TTS_APP_KEY / TTS_APP_SECRET / TTS_SERVICE_ID in .env and restart this script."
[ -n "$ADMIN_EMAIL" ] || info "No login yet? Re-run with --create-admin you@example.com"
info "Logs: var/logs/{api,worker,web,tunnel}.log   Stop: Ctrl-C"
echo

# Stream API + worker logs until Ctrl-C.
tail -n 0 -F var/logs/api.log var/logs/worker.log &
PIDS="$PIDS $!"
wait
