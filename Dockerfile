FROM node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 构建 Next.js
RUN npm run build

# 暴露端口
EXPOSE 8080

# 启动：映射 Zeabur PG 变量 → DATABASE_URL，然后迁移+启动
CMD ["sh", "-c", "export DATABASE_URL=${DATABASE_URL:-${POSTGRES_URL:-${POSTGRES_URI:-$POSTGRESQL_URL}}} && echo \"DATABASE_URL=$DATABASE_URL\" && npx prisma migrate deploy && npm run start"]
