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

# 启动：先迁移数据库，再启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
