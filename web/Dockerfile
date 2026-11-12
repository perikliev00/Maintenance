# Build context MUST be the repository root (not ./web alone).
# capabilities.ts imports ../../../api/src/contracts/permissionsCatalog.
# Build stage: install web deps and produce the static SPA dist/.
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
# Work inside the web package directory.
WORKDIR /src/web
# Copy package manifests first for npm layer caching.
COPY web/package.json web/package-lock.json ./
# Patched deepmerge (GHSA-gcqx-w48m-w2h4) is resolved via file: override.
# Copy the vendored patched deepmerge package into the image.
COPY web/vendor/deepmerge /src/web/vendor/deepmerge
# Install web dependencies including the local deepmerge override.
RUN npm ci
# Copy the remainder of the web package sources.
COPY web/ ./
# Shared permissions catalog (single source with API) — outside the web package tree.
# Copy the shared permissions catalog so the web build can import it.
COPY api/src/contracts/permissionsCatalog.ts /src/api/src/contracts/permissionsCatalog.ts
# Build the production SPA into dist/.
RUN npm run build

# Patch go-jose/v3.0.5 with the CVE-2026-116587 RSA bounds from v4.1.6.
# Upstream publishes no fixed v3 release; Caddy still pulls v3 transitively.
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS gojose-v3-patch
# Install git needed to clone and commit the patched module.
RUN apk add --no-cache git
# Work at /src for the go-jose checkout.
WORKDIR /src
# Copy the Node patch script used to edit jwk.go.
COPY web/caddy/patch-go-jose-v3.mjs /tmp/patch-go-jose-v3.mjs
# Clone go-jose v3.0.5, apply the RSA bound patch, and retag as v3.0.6.
RUN git clone --depth 1 --branch v3.0.5 https://github.com/go-jose/go-jose.git /src/go-jose-v3 \
 && node /tmp/patch-go-jose-v3.mjs /src/go-jose-v3/jwk.go \
 && git -C /src/go-jose-v3 config user.email "ci@maintenance.local" \
 && git -C /src/go-jose-v3 config user.name "maintenance-ci" \
 && git -C /src/go-jose-v3 add jwk.go \
 && git -C /src/go-jose-v3 commit -m "security: bound RSA JWK modulus (CVE-2026-116587)" \
 && git -C /src/go-jose-v3 tag -f v3.0.6

# Rebuild the pinned Caddy release with patched Go modules on the pinned toolchain.
FROM caddy:2.11.7-builder-alpine@sha256:ef9b65adf9a224770c6d5f6d1ae1bf99bc3caaa78d8c4bae3ea949ee6984f301 AS caddy-build
# Bring the patched go-jose v3 module into the builder.
COPY --from=gojose-v3-patch /src/go-jose-v3 /src/go-jose-v3
# Build Caddy with module replacements and verify go-jose/net versions in the binary.
RUN mkdir -p /out \
 && GOTOOLCHAIN=local xcaddy build v2.11.7 \
      --replace golang.org/x/net=golang.org/x/net@v0.62.0 \
      --replace github.com/go-jose/go-jose/v4=github.com/go-jose/go-jose/v4@v4.1.8 \
      --replace github.com/go-jose/go-jose/v3=/src/go-jose-v3 \
      --output /out/caddy \
 && /out/caddy version \
 && go version -m /out/caddy | grep -E 'go-jose|golang.org/x/net' || true \
 && grep -aF 'go-jose/go-jose: invalid RSA key, modulus too large' /out/caddy \
 && go version -m /out/caddy | grep -F 'github.com/go-jose/go-jose/v4' | grep -F 'v4.1.8' \
 && go version -m /out/caddy | grep -F 'golang.org/x/net' | grep -F 'v0.62.0'

# Final web runtime: patched Caddy serving the SPA.
FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f AS web
# Replace the stock Caddy binary with the patched build.
COPY --from=caddy-build /out/caddy /usr/bin/caddy
# Install the site Caddyfile.
COPY web/Caddyfile /etc/caddy/Caddyfile
# Install the built SPA assets under /srv.
COPY --from=build /src/web/dist /srv
# SEC-005 / B1: create the unprivileged user; the upstream image runs as root.
# Compose adds
# NET_BIND_SERVICE so :80/:443 still work after cap_drop ALL.
# Patch Alpine packages in the pinned Caddy base (brotli/curl HIGH CVEs).
RUN apk upgrade --no-cache \
 && addgroup -S -g 1000 caddy \
 && adduser -S -D -H -u 1000 -G caddy caddy \
 && mkdir -p /data /config \
 && chown -R caddy:caddy /srv /etc/caddy /data /config
# Drop privileges to the caddy user for the long-running process.
USER caddy
# Probe the internal health endpoint to mark the container healthy.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8081/health || exit 1
# Expose HTTP, HTTPS, and HTTP/3 UDP ports.
EXPOSE 80 443 443/udp
# Start Caddy with the site Caddyfile.
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
