FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY services/worker/package.json ./services/worker/

RUN npm install

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY services/worker ./services/worker
RUN mkdir -p /app/data/hls

RUN mkdir -p apps/web/public

RUN npm run build --workspace=@aspreen/shared
RUN npm run build --workspace=@aspreen/api
RUN npm run build --prefix apps/web

FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache ffmpeg bash python3

ENV NODE_ENV=production
ENV INTERNAL_API_URL=http://127.0.0.1:3001
ENV STREAM_PROXY_URL=http://127.0.0.1:8088
ENV STREAM_STORAGE_PATH=/app/data/hls

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY services/worker/package.json ./services/worker/

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/next.config.js ./apps/web/next.config.js
COPY channels.json ./channels.json
COPY channels.json ./apps/api/channels.json
COPY scripts/start-railway.sh ./start-railway.sh
COPY scripts/aspreen_stream_proxy_daemon.py ./scripts/aspreen_stream_proxy_daemon.py

RUN chmod +x ./start-railway.sh
RUN mkdir -p /app/data/hls

EXPOSE 3000

CMD ["./start-railway.sh"]

