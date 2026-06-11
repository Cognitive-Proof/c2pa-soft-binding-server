FROM node:20-alpine AS builder
WORKDIR /app
# python3/make/g++ are needed to build better-sqlite3's native addon if no
# prebuilt binary is available for this platform.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY plugins/types/package.json plugins/types/
COPY plugins/mongoDB/package.json plugins/mongoDB/
COPY plugins/gcpBucket/package.json plugins/gcpBucket/
COPY plugins/awsBucket/package.json plugins/awsBucket/
COPY plugins/sqlite/package.json plugins/sqlite/
COPY plugins/postgres/package.json plugins/postgres/
COPY plugins/mysql/package.json plugins/mysql/
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY plugins/types/package.json plugins/types/
COPY plugins/mongoDB/package.json plugins/mongoDB/
COPY plugins/gcpBucket/package.json plugins/gcpBucket/
COPY plugins/awsBucket/package.json plugins/awsBucket/
COPY plugins/sqlite/package.json plugins/sqlite/
COPY plugins/postgres/package.json plugins/postgres/
COPY plugins/mysql/package.json plugins/mysql/
RUN npm ci --omit=dev && apk del python3 make g++
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/plugins/types/dist ./plugins/types/dist
COPY --from=builder /app/plugins/mongoDB/dist ./plugins/mongoDB/dist
COPY --from=builder /app/plugins/gcpBucket/dist ./plugins/gcpBucket/dist
COPY --from=builder /app/plugins/awsBucket/dist ./plugins/awsBucket/dist
COPY --from=builder /app/plugins/sqlite/dist ./plugins/sqlite/dist
COPY --from=builder /app/plugins/postgres/dist ./plugins/postgres/dist
COPY --from=builder /app/plugins/mysql/dist ./plugins/mysql/dist
COPY --from=builder /app/openapi.yaml ./openapi.yaml
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3000
CMD ["node", "dist/cli.js"]
