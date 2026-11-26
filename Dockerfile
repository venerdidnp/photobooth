# Photobooth: server Node + frontend yang sudah dibuild. Data (foto, antrean upload, token Drive) ada di volume /data.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data

EXPOSE 8080
CMD ["npx", "tsx", "server/src/index.ts"]
