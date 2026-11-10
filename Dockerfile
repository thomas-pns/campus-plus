# Campus+ : image du serveur (appli web + API)
FROM node:22-slim AS appli
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM node:22-slim AS serveur
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data CLIENT_DIR=/app/client
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=serveur /src/server/dist ./dist
COPY --from=appli /src/client/dist ./client
LABEL org.opencontainers.image.source="https://github.com/thomas-pns/campus-plus"
LABEL org.opencontainers.image.description="Campus+ : planning, notes et alertes pour les élèves de CPE Lyon (non officiel)"
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
