FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Keep the Prisma CLI in the one-shot migration image.
FROM build AS migrate
USER node
ENTRYPOINT ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM build AS bootstrap
USER node
CMD ["node", "dist/bootstrap.js"]

FROM build AS owner-bootstrap
USER node
CMD ["node", "dist/createOwner.js"]

FROM build AS runtime-deps
RUN cp -a node_modules/.prisma /tmp/prisma-generated \
 && npm prune --omit=dev \
 && rm -rf node_modules/prisma node_modules/@prisma/config node_modules/deepmerge-ts \
 && mkdir -p node_modules/.prisma \
 && cp -a /tmp/prisma-generated/client node_modules/.prisma/client

FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
# npm is build tooling and is not required by the API process.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
