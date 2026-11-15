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

Admin panel (not linked anywhere on the public site): `http://127.0.0.1:3947/alb`

## Production

```bash
cd web
npm run build
npm start
```

`npm start` serves the obfuscated `dist/` build, live `/media` + `/video` from `public/`, upload API, and `/alb`.

## Uploads

- Public UPLOAD button → description required (**max 2000 characters**)
- Prompt asks for where it is from, what is happening, and why it feels paranormal (no personal contact info)
- **5 uploads / 5 minutes / IP**
- Cloudflare Turnstile when `REQUIRE_TURNSTILE=true`
- Upload responses never echo IP or storage paths
- Files land in `web/pending-uploads/` until accepted in `/alb`

## Admin (`/alb`)

Configure in `.env` (see `.env.example`):

- `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- `SESSION_SECRET` (≥ 32 random chars)
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`
- `REQUIRE_TURNSTILE=true` in production

Security / anonymity baked in:

- Noindex / no-referrer / stripped `Server` + `X-Powered-By`
- HSTS when served over HTTPS; `__Host-` admin cookies when Secure
- HttpOnly + SameSite=Strict session cookies (HMAC-signed)
- CSRF on every mutating admin request; `Clear-Site-Data` on logout
- Login rate limit (5 / 15 min / IP) + global API throttle
- Constant-time credential compare + minimum response delay
- Cloudflare Turnstile on admin login (and public uploads)
- Trusts `CF-Connecting-IP` when behind Cloudflare
- TRACE/TRACK blocked; pending previews auth-only
- Public catalog never includes uploader IPs (admin sees IP + peppered hash)
- Catalog descriptions editable for every library asset; accept/deny pending

Accepted media is copied into `public/media` or `public/video`, indexes rebuilt, and descriptions stored in `data/catalog.json`.

## Notes

- Infinite scroll walks every still/tape once, then reshuffles and starts again (more media = longer before a loop)
- Accepted uploads are featured first on the opening lap and open their description on click
- Strip DOM recycled; max 2 videos playing; lazy video `src`
- Production JS: terser + javascript-obfuscator, no sourcemaps
- No real murder-victim corpse imagery
