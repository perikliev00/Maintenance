# Build stage: install deps, generate Prisma client, and compile TypeScript.
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
# Work inside /app for all subsequent build steps.
WORKDIR /app
# Copy package manifests first to maximize Docker layer caching for npm ci.
COPY package.json package-lock.json ./
# Install the full dependency tree including build/dev tooling.
RUN npm ci
# Copy Prisma schema/migrations needed for client generation.
COPY prisma ./prisma
# Generate the Prisma client into node_modules.
RUN npx prisma generate
# Copy TypeScript compiler configuration.
COPY tsconfig.json ./
# Copy application source for compilation.
COPY src ./src
# Compile TypeScript into dist/.
RUN npm run build

# Keep the Prisma CLI in the one-shot migration image.
FROM build AS migrate
# Run migrations as the non-root node user.
USER node
# Default entrypoint deploys pending Prisma migrations.
ENTRYPOINT ["./node_modules/.bin/prisma", "migrate", "deploy"]

# One-shot image that runs bootstrap defaults after migrate.
FROM build AS bootstrap
# Run bootstrap as the non-root node user.
USER node
# Execute the compiled bootstrap script.
CMD ["node", "dist/bootstrap.js"]

# One-shot image that creates the initial owner account.
FROM build AS owner-bootstrap
# Run owner bootstrap as the non-root node user.
USER node
# Execute the compiled createOwner script.
CMD ["node", "dist/createOwner.js"]

# Prune to production node_modules while preserving generated Prisma client.
FROM build AS runtime-deps
# Keep generated Prisma client, prune dev deps, and drop unused packages.
RUN cp -a node_modules/.prisma /tmp/prisma-generated \
 && npm prune --omit=dev \
 && rm -rf node_modules/prisma node_modules/@prisma/config node_modules/deepmerge-ts \
 && mkdir -p node_modules/.prisma \
 && cp -a /tmp/prisma-generated/client node_modules/.prisma/client

# Final API runtime image with production deps and compiled dist only.
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS api
# Mark the process as production for library behavior.
ENV NODE_ENV=production
# Work inside /app for the runtime process.
WORKDIR /app
# Copy pruned production node_modules owned by node.
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
# Copy package.json for runtime metadata/scripts references.
COPY --from=runtime-deps --chown=node:node /app/package.json ./package.json
# Copy compiled JavaScript output.
COPY --from=build --chown=node:node /app/dist ./dist
# Copy Prisma schema/migrations for runtime introspection if needed.
COPY --from=build --chown=node:node /app/prisma ./prisma
# npm is build tooling and is not required by the API process.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# Drop to the non-root node user for the long-running API process.
USER node
# Document the API listen port.
EXPOSE 4000
# Start the compiled API entrypoint.
CMD ["node", "dist/index.js"]
