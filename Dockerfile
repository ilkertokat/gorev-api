FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production DB_PATH=/data/gorev.db PORT=3000
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "src/server.ts"]
