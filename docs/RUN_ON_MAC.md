# Run the OMS on a Mac

`scripts/mac-dev.sh` starts everything on one Mac: Postgres and Redis in Docker, the API, the worker, the web app,
and a Cloudflare tunnel so TikTok can reach the OAuth callback and webhooks. Ctrl-C stops it all.

## One-time setup

```bash
brew install node@22 cloudflared git
brew install --cask docker        # open Docker Desktop once and leave it running
git clone https://github.com/GRITui/tiktok-api.git && cd tiktok-api
```

## Start

```bash
scripts/mac-dev.sh --create-admin you@example.com   # first run: also creates your login (asks for a password)
scripts/mac-dev.sh                                  # later runs
```

The script:

1. checks the tools above (and enables `pnpm` via corepack),
2. creates `.env` if missing, generates `TOKEN_ENCRYPTION_KEY`, and uses placeholder TikTok credentials until you set real ones,
3. installs dependencies, starts Postgres/Redis, applies migrations,
4. starts a tunnel and writes `WEBHOOK_PUBLIC_URL` into `.env`,
5. starts the API (:3000), worker and web app (:5173), keeps the Mac awake with `caffeinate`,
6. prints the **Redirect URL** and **Webhook URL** to paste into TikTok Partner Center.

Logs are in `var/logs/` (`api`, `worker`, `web`, `tunnel`).

## Tunnel options

| Command | URL | When |
| --- | --- | --- |
| `scripts/mac-dev.sh` | random `*.trycloudflare.com`, **new on every restart** | trying things out; update both URLs in Partner Center after each restart |
| `scripts/mac-dev.sh --tunnel-name oms --public-url https://oms.example.com` | fixed | you have a domain on Cloudflare (see below) |
| `scripts/mac-dev.sh --no-tunnel` | none | UI only; TikTok cannot reach the Mac |

Named tunnel, once:

```bash
cloudflared tunnel login
cloudflared tunnel create oms
cloudflared tunnel route dns oms oms.example.com
```

## After TikTok approves your app

Put the values from Partner Center into `.env`, then restart the script:

```
TTS_APP_KEY=...
TTS_APP_SECRET=...
TTS_SERVICE_ID=...
```

Open http://localhost:5173 → **Shops** → **Connect Shop** (US or ROW).

## Notes

- Keep `TOKEN_ENCRYPTION_KEY` safe: stored seller tokens cannot be decrypted without it.
- Postgres and Redis keep running in Docker after Ctrl-C (`docker compose stop` to stop them; data persists in a volume).
- Already running Postgres/Redis yourself? `SKIP_DOCKER=1 scripts/mac-dev.sh` uses `DATABASE_URL` / `REDIS_URL` from `.env`.
