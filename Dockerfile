FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV COCKPIT_PORT=8080
EXPOSE 8080
CMD ["node", "cockpit-server.js"]
