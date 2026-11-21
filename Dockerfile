# Dockerfile

# ---------------------------------------------------------
# Stage 1: 安裝相依套件
# ---------------------------------------------------------
    FROM node:22-bookworm-slim AS deps
    WORKDIR /app
    
    COPY package.json package-lock.json* ./
    RUN npm ci
    
    # ---------------------------------------------------------
    # Stage 2: 建置 Next.js 應用程式
    # ---------------------------------------------------------
    FROM node:22-bookworm-slim AS builder
    WORKDIR /app
    
    ENV NEXT_TELEMETRY_DISABLED=1
    
    # 建置階段若需讀取公開環境變數，可於 docker build --build-arg 傳入
    ARG NEXT_PUBLIC_SUPABASE_URL
    ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
    ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
    ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    COPY --from=deps /app/node_modules ./node_modules
    COPY . .
    
    RUN npm run build
    
    # ---------------------------------------------------------
    # Stage 3: 正式執行環境（含 Playwright Chromium）
    # ---------------------------------------------------------
    FROM node:22-bookworm-slim AS runner
    WORKDIR /app
    
    ENV NODE_ENV=production
    ENV NEXT_TELEMETRY_DISABLED=1
    ENV PORT=3000
    ENV HOSTNAME="0.0.0.0"
    
    # 複製執行所需檔案
    COPY --from=builder /app/package.json ./package.json
    COPY --from=builder /app/public ./public
    COPY --from=builder /app/.next ./.next
    COPY --from=builder /app/node_modules ./node_modules
    
    # 安裝與目前 playwright 版本相符的 Chromium 及系統相依套件
    RUN npx playwright install --with-deps chromium
    
    EXPOSE 3000
    
    CMD ["npm", "run", "start"]