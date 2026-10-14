# ===== 构建阶段 =====
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 需要编译工具链
RUN apk add --no-cache python3 make g++

# 安装依赖（利用层缓存）
COPY package.json package-lock.json* ./
RUN npm ci

# 复制源码并构建
COPY . .
RUN npm run build

# ===== 运行阶段 =====
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# better-sqlite3 运行时需要编译产物；重新安装生产依赖以确保原生模块正确
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# 从构建阶段复制构建产物
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/postcss.config.mjs ./
COPY --from=builder /app/tailwind.config.ts ./

# 数据目录（SQLite）。注意：不要在 Dockerfile 里写 VOLUME 指令，
# Railway 等平台不支持；持久化由平台卷挂载到 /app/data 实现。
RUN mkdir -p /app/data

EXPOSE 3000

# 默认用 SQLite 文件（可被 DATABASE_URL 覆盖）
ENV DATABASE_URL=./data/unical.db

CMD ["npm", "start"]
