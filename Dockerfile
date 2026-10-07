# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_* values are baked into the client bundle.
ARG VITE_LIBRARY_REPO
ARG VITE_LIBRARY_BRANCH
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY migrations ./migrations
# Users, sessions, saved credentials, tabs and the query audit log (SQLite; D1 on Cloudflare).
# Mount a volume here or they are lost when the container is replaced.
ENV DATABASE_PATH=/data/workbench.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/entry-node.ts"]
