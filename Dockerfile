FROM node:20-slim
WORKDIR /app
# Astream系スクリプト用に python3 を追加（標準ライブラリのみ使用・pip不要）
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV COCKPIT_PORT=8080
EXPOSE 8080
CMD ["node", "cockpit-server.js"]
