FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/stdio/package.json packages/stdio/package.json
RUN npm ci
RUN node -e "require('better-sqlite3')"

COPY tsconfig.base.json tsconfig.json ./
COPY packages/core packages/core
COPY packages/server packages/server
RUN npm run build:server && npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime

ENV MCP_HOST=0.0.0.0 \
    MCP_PORT=8080 \
    MCP_STATE_DATABASE=/data/oauth.sqlite \
    NODE_ENV=production
WORKDIR /app
# The server only needs node. npm and corepack carry their own dependency
# trees and are the main source of scanner findings, so the runtime drops them.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && groupadd --gid 10001 watchgoose \
    && useradd --uid 10001 --gid watchgoose --no-create-home --shell /usr/sbin/nologin watchgoose \
    && mkdir /data \
    && chmod 700 /data \
    && chown watchgoose:watchgoose /data
COPY --from=build --chown=watchgoose:watchgoose /app/node_modules ./node_modules
COPY --from=build --chown=watchgoose:watchgoose /app/package.json ./package.json
COPY --from=build --chown=watchgoose:watchgoose /app/packages/core/package.json ./packages/core/package.json
COPY --from=build --chown=watchgoose:watchgoose /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=watchgoose:watchgoose /app/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=watchgoose:watchgoose /app/packages/server/dist ./packages/server/dist

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||'8080')+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "packages/server/dist/cli.js", "serve"]
