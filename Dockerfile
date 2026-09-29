# One image runs both the API (which also serves the web app) and the worker: choose the command at deploy time.
#   API:    node backend/dist/main.js
#   Worker: node backend/dist/jobs/worker.js
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY backend backend
COPY frontend frontend
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
ENV NODE_ENV=production WEB_DIST=/app/frontend/dist HOST=0.0.0.0 PORT=3018
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/backend/package.json backend/
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/migrations backend/migrations
COPY --from=build /app/backend/certs backend/certs
COPY --from=build /app/frontend/dist frontend/dist
USER node
EXPOSE 3018
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","backend/dist/main.js"]
