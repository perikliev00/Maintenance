FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Rebuild the pinned Caddy release with the fixed x/net module on the pinned Go toolchain.
FROM caddy:2.11.7-builder-alpine@sha256:ef9b65adf9a224770c6d5f6d1ae1bf99bc3caaa78d8c4bae3ea949ee6984f301 AS caddy-build
RUN mkdir -p /out \
 && xcaddy build v2.11.7 \
      --replace golang.org/x/net=golang.org/x/net@v0.60.0 \
      --output /out/caddy

FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f AS web
COPY --from=caddy-build /out/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# SEC-005 / B1: create the unprivileged user; the upstream image runs as root.
# Compose adds
# NET_BIND_SERVICE so :80/:443 still work after cap_drop ALL.
# Patch Alpine packages in the pinned Caddy base (brotli/curl HIGH CVEs).
RUN apk upgrade --no-cache \
 && addgroup -S -g 1000 caddy \
 && adduser -S -D -H -u 1000 -G caddy caddy \
 && mkdir -p /data /config \
 && chown -R caddy:caddy /srv /etc/caddy /data /config
USER caddy
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8081/health || exit 1
EXPOSE 80 443 443/udp
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
