# LOOK BACK — production image (Node server + vault + obfuscated dist)
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
# Production client build + admin obfuscation
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3947 \
    CLOUD=true \
    TRUST_PROXY=true \
    COOKIE_SECURE=auto \
    REQUIRE_TURNSTILE=true

RUN useradd --system --uid 10001 --create-home lookback
COPY --from=build --chown=lookback:lookback /app ./

USER lookback
EXPOSE 3947

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3947)+'/api/public/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
