# Trepoトレンド大賞 実績シグナル収集ツール — Cloud Run用
# ビルド文脈はリポジトリルート（scripts/ と root の node依存を含めるため）。
#   例: gcloud builds submit --config award-signal-tool/cloudbuild.yaml ... .
FROM node:20-slim
WORKDIR /app

# Python（検索の伸び=pytrends / メディア=標準ライブラリ）
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Python依存（pytrends/pandas/urllib3<2）
COPY scripts/requirements.txt scripts/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r scripts/requirements.txt

# ルートのnode依存（fetch_tiktok.js が axios/dotenv を使う）
COPY package*.json ./
RUN npm ci --omit=dev

# ツールのnode依存（express / google-auth-library）
COPY award-signal-tool/package*.json award-signal-tool/
RUN cd award-signal-tool && npm ci --omit=dev

# ソース
COPY scripts scripts
COPY award-signal-tool award-signal-tool

ENV PORT=8080
EXPOSE 8080
CMD ["node", "award-signal-tool/server.js"]
