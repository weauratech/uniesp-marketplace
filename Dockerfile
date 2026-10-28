FROM node:26-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002 DB_PATH=/app/data/marketplace.sqlite WEB_DIST=/app/web/dist APP_ORIGIN=http://127.0.0.1:5177 PAYMENT_MODE=demo PAYMENT_PROVIDER=none
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server/ ./server/
COPY --from=web-build --chown=node:node /app/web/dist ./web/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3002/api/health').then(async r=>{if(!r.ok || (await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
