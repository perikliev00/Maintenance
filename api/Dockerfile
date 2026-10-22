FROM node:22.18.0-alpine AS build
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

FROM node:22.18.0-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
