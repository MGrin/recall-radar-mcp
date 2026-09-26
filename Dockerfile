# One-command judge path: docker build -t recall-radar-mcp . && docker run --rm -p 3000:3000 recall-radar-mcp
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ARG BB_PROJECT_ID=unknown
ARG BB_ENV_ID=canonical
LABEL org.opencontainers.image.title="recall-radar-mcp" \
      org.opencontainers.image.licenses="MIT" \
      bb.project="$BB_PROJECT_ID" bb.env="$BB_ENV_ID"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WATCHLIST_PATH=/data/watchlist.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/http.js"]
