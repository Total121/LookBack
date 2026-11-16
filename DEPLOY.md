# Deploy

Long-running Node + vault app. Use a Docker-capable host (not serverless).

## Environment (set in the host dashboard — never commit)

| Key | Required | Notes |
|---|---|---|
| `ADMIN_PATH` | **strongly recommended** | Obscure path (e.g. `/x7k9m2qp`). Do not leave `/alb`. |
| `ADMIN_USERNAME` | yes | Admin login |
| `ADMIN_PASSWORD` | yes | ≥12 chars, not a placeholder |
| `SESSION_SECRET` | yes | ≥32 random chars |
| `TURNSTILE_SITE_KEY` | yes (prod) | Cloudflare Turnstile |
| `TURNSTILE_SECRET_KEY` | yes (prod) | Cloudflare Turnstile |
| `REQUIRE_TURNSTILE` | yes | Must be `true` in production |
| `HOST` | yes on cloud | `0.0.0.0` |
| `TRUST_PROXY` | yes on cloud | `true` behind reverse proxy |
| `COOKIE_SECURE` | yes | `auto` |
| `CLOUD` | yes on cloud | `true` |
| `DATA_ROOT` | for persistence | e.g. `/var/data` when a disk is mounted |

## Persistence (important)

**Free web services have an ephemeral filesystem.** Seed media ships in the image; accepted uploads, pending queue, catalog, and settings **reset on redeploy/sleep** unless you attach durable storage.

### Paid plan + disk (recommended for real use)

1. Upgrade the service off Free (Render disks need a paid compute plan).
2. Add a disk, mount at `/var/data` (1 GB is enough to start).
3. Set env `DATA_ROOT=/var/data`.
4. Redeploy.

On boot the app:

- writes vault / pending / data under `DATA_ROOT`
- copies **missing** seed media from the image into the disk once
- keeps accepted uploads + catalog across redeploys

Optional overrides (instead of `DATA_ROOT`):

- `VAULT_DIR`
- `PENDING_DIR`
- `DATA_DIR`

### Free tier

Works for demos. Expect cold starts (~30–60s) and lost uploads after sleep/redeploy. Collage seed still loads from the image.

## Custom domain (anonymity)

Point your own domain at the service in the host dashboard (remove `*.onrender.com` from the public URL). Add that hostname to Cloudflare Turnstile. Set a long random `ADMIN_PATH` before sharing the link.

## Blueprint

`render.yaml` at repo root. Connect the repo and apply the blueprint, then fill secrets in the dashboard.

`render.persist.yaml` is a starter+disk example you can merge when ready for durable uploads.

## Local Docker check (optional)

```bash
docker build -t app .
docker run --rm -p 3947:3947 --env-file web/.env -e HOST=0.0.0.0 -e CLOUD=true app
```

With a local volume:

```bash
docker run --rm -p 3947:3947 -v lookback-data:/var/data --env-file web/.env -e DATA_ROOT=/var/data -e HOST=0.0.0.0 -e CLOUD=true app
```

## Notes

- Do not publish admin path, credentials, or service IDs in public docs.
- Feed tiles use WebP thumbs when available; tear overlays still use full originals (same look).
