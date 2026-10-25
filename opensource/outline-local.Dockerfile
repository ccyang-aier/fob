FROM node:26.12.1-slim AS builder
WORKDIR /opt/outline
RUN npm install --global corepack@0.36.0 && corepack enable
ENV NODE_OPTIONS=--max-old-space-size=6144 HUSKY=0 YARN_HTTP_TIMEOUT=1000000 YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org
COPY package.json yarn.lock .yarnrc.yml ./
COPY patches ./patches
RUN yarn install --immutable
COPY . .
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
RUN yarn build

FROM node:26.12.1-slim AS runner
WORKDIR /opt/outline
ENV NODE_ENV=production PORT=3000 WEB_CONCURRENCY=1 MALLOC_ARENA_MAX=2 FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data
LABEL org.opencontainers.image.source="https://github.com/outline/outline"
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}
COPY --from=builder --chown=node:node /opt/outline/build ./build
COPY --from=builder --chown=node:node /opt/outline/server ./server
COPY --from=builder --chown=node:node /opt/outline/public ./public
COPY --from=builder --chown=node:node /opt/outline/node_modules ./node_modules
COPY --from=builder --chown=node:node /opt/outline/package.json /opt/outline/.sequelizerc ./
RUN mkdir -p /var/lib/outline/data && chown -R node:node /var/lib/outline
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=12 CMD node -e "fetch('http://127.0.0.1:3000/_health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "build/server/index.js"]
