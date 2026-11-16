# Deploy LOOK BACK (free / secure)

## Why not Vercel + Supabase (yet)

This app is a **long-running Node server** with a private **vault filesystem**, pending uploads, reactions, and in-memory admin sessions.

- **Vercel** = serverless / edge. It cannot keep the vault, pending queue, or Node `http` server as written.
- **Supabase** would need a full storage/DB rewrite (Storage buckets + Postgres catalog).

For free + secure **without rewriting the app**, we deploy to **Render** (Docker web service, HTTPS, GitHub auto-deploy).

> Free Render notes: service sleeps after ~15 min idle; filesystem is ephemeral (seed vault is baked into the image; accepted uploads reset on redeploy/sleep until you add a paid disk later).

## 1. Push is already on GitHub

Repo: `https://github.com/Total121/LookBack`

## 2. Create the Render service

1. Open https://dashboard.render.com
2. Sign in with **GitHub** (Total121)
3. **New** → **Blueprint**
4. Select repo **Total121/LookBack**
5. Apply `render.yaml` (service name `lookback`)

Or **New** → **Web Service** → Docker → same repo, Dockerfile at repo root.

## 3. Environment variables (you fill these)

Set these in Render → Service → Environment (do **not** commit them):

| Key | Required | Notes |
|---|---|---|
| `ADMIN_USERNAME` | yes | Admin login for `/alb` |
| `ADMIN_PASSWORD` | yes | ≥12 chars, not a placeholder |
| `SESSION_SECRET` | yes | Blueprint can auto-generate; or 64+ hex chars |
| `TURNSTILE_SITE_KEY` | yes (prod) | From Cloudflare Turnstile |
| `TURNSTILE_SECRET_KEY` | yes (prod) | From Cloudflare Turnstile |
| `REQUIRE_TURNSTILE` | yes | Must be `true` in production |
| `HOST` | set by blueprint | `0.0.0.0` |
| `TRUST_PROXY` | set by blueprint | `true` |
| `COOKIE_SECURE` | set by blueprint | `auto` |
| `CLOUD` | set by blueprint | `true` |

Turnstile: https://dash.cloudflare.com/ → Turnstile → add your `*.onrender.com` host.

## 4. Live service (already created)

- Public site: **https://lookback-x8jo.onrender.com**
- Admin: **https://lookback-x8jo.onrender.com/alb** (not linked from the site)
- Dashboard: https://dashboard.render.com/web/srv-dbthfeui0phs73f2bs50

First boot after idle sleep can take ~30–60s.

### Replace bootstrap secrets

The first deploy used temporary admin credentials + Cloudflare Turnstile **test** keys (`1x0000…`) so the box could boot. In Render → Environment, replace:

1. `ADMIN_USERNAME` / `ADMIN_PASSWORD` with yours  
2. `SESSION_SECRET` with a fresh long random secret  
3. `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` with your real Cloudflare Turnstile keys (add host `lookback-x8jo.onrender.com`)  

Then **Manual Deploy → Clear build cache & deploy**.

## 5. Local Docker check (optional)

```bash
docker build -t lookback .
docker run --rm -p 3947:3947 --env-file web/.env -e HOST=0.0.0.0 -e CLOUD=true lookback
```
