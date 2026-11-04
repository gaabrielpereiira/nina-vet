FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node server/src ./src
COPY --chown=node:node server/migrations ./migrations
COPY --chown=node:node server/scripts ./scripts
COPY --chown=node:node server/sql ./sql
COPY --chown=node:node server/clinic-import-tables.json ./clinic-import-tables.json
RUN install -d -m 0700 -o node -g node /app/media
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/index.mjs"]
