FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Build Caddy from its pinned source using the current patched Go toolchain.
FROM caddy:2.11.7-builder-alpine@sha256:ef9b65adf9a224770c6d5f6d1ae1bf99bc3caaa78d8c4bae3ea949ee6984f301 AS caddy-build
WORKDIR /src
RUN git init . \
 && git remote add origin https://github.com/caddyserver/caddy.git \
 && git fetch --depth=1 origin 72dd0fb067f6d7826c7f79907670ba4a713bfe37 \
 && git checkout --detach FETCH_HEAD \
 && go mod edit -require=golang.org/x/net@v0.60.0 \
 && go mod download golang.org/x/net@v0.60.0
RUN mkdir -p /out \
 && CGO_ENABLED=0 go build -mod=mod -trimpath \
      -ldflags="-X github.com/caddyserver/caddy/v2.CustomVersion=v2.11.7" \
      -o /out/caddy ./cmd/caddy

FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f AS web
COPY --from=caddy-build /out/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80 443 443/udp
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
