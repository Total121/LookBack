# Deploy

Long-running Node + vault app. Use a Docker-capable host (not serverless).

## Environment (set in the host dashboard — never commit)

| Key | Required | Notes |
|---|---|---|
| `ADMIN_PATH` | recommended | Obscure path for admin UI (e.g. `/x7k9m2qp`) |
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

## Blueprint

`render.yaml` at repo root defines a Docker web service. Connect the repo in your host dashboard and apply the blueprint, or create a Web Service from the Dockerfile.

Add your Turnstile host for the public domain you assign.

## Local Docker check (optional)

```bash
docker build -t app .
docker run --rm -p 3947:3947 --env-file web/.env -e HOST=0.0.0.0 -e CLOUD=true app
```

## Notes

- Free tiers often sleep after idle; cold start can take 30–60s.
- Ephemeral filesystem: seed vault is in the image; accepted uploads reset on redeploy unless you attach persistent disk.
- Do not publish admin path, credentials, or service IDs in public docs.
