# LOOK BACK

R18 infinite horror collage. Anonymous.

## Run

```bash
cd web
cp .env.example .env   # then edit credentials + Turnstile keys
npm install
npm run dev
```

Open `http://127.0.0.1:3947`

Admin UI path comes from `ADMIN_PATH` in `.env` (default `/alb`). Never linked from the public site.

## Production (local)

```bash
cd web
npm run build
npm start
```

Serves the obfuscated `dist/` build, vault media via opaque `/m/` tokens, upload API, and admin UI.

## Deploy

Long-running Node + vault — not a serverless static fit. See [`DEPLOY.md`](./DEPLOY.md).

For durable uploads on a paid host: mount a disk and set `DATA_ROOT` (see `render.persist.yaml`). Free tiers stay ephemeral.

## Uploads

- Public UPLOAD → description required (max 2000 characters)
- **5 uploads / 5 minutes / IP**
- Cloudflare Turnstile when `REQUIRE_TURNSTILE=true`
- Upload responses never echo IP or storage paths
- Files land in `web/pending-uploads/` until accepted in admin

## Admin

Configure in `.env` (see `.env.example`):

- `ADMIN_PATH` (obscure URL segment)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- `SESSION_SECRET` (≥ 32 random chars)
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`
- `REQUIRE_TURNSTILE=true` in production

Hardening:

- Noindex / no-referrer / stripped `Server` + `X-Powered-By`
- HSTS over HTTPS; `__Host-` admin cookies when Secure
- HttpOnly + SameSite=Strict sessions (HMAC-signed)
- CSRF on mutating admin requests; login rate limit + API throttle
- Constant-time credential compare
- Vault media only via short-lived opaque tokens (`/m/…`)
- Client cloaks tile media as `blob:` URLs in the DOM

## Notes

- Infinite scroll; strips virtualize (remount on scroll-up)
- Max 2 videos playing; lazy video load
- Production JS: terser + javascript-obfuscator, no sourcemaps
