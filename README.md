# Threads 帳號貼文爬取與數據分析工具 (Threads Analytics Dashboard)

專案是一個基於 Next.js、Supabase 與 Playwright 的 Threads 帳號貼文爬取與數據分析工具，結合 LLM 進行 NLP 貼文成敗原因分析，並提供豐富的互動儀表板與多帳號比較功能。

---

## 一、 如何安裝 (Installation)

1. **複製專案庫**：
   ```bash
   git clone <repository-url>
   cd threads-analysis-vibe
   ```

2. **安裝依賴套件**：
   ```bash
   npm install
   # 或使用 pnpm
   pnpm install
   ```

3. **環境變數設定**：
   複製 `.env.example` 為 `.env.local`，並填入您的 Supabase 與 LLM 相關密鑰：
   ```bash
   cp .env.example .env.local
   ```

   環境變數說明：
   - **Supabase 連線與 Auth**
     - `NEXT_PUBLIC_SUPABASE_URL`：Supabase 專案 URL
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase 公開金鑰（前端與已登入使用者操作）
     - `SUPABASE_SERVICE_ROLE_KEY`：Supabase 服務金鑰（僅限 Server-side 後端寫入與 Seed 腳本使用，嚴禁暴露於前端）
     - `NEXT_PUBLIC_SITE_URL`：應用程式網址（用於 Supabase Magic Link 與 OAuth Callback 導向，本地開發預設為 `http://localhost:3000`）
   - **LLM NLP 分析設定**
     - `LLM_PROVIDER`：選用的模型供應商（`gemini` 或 `openai`）
     - `GEMINI_API_KEY` / `OPENAI_API_KEY`：對應供應商的 API Key
     - `LLM_MODEL`：使用的模型名稱（預設 `gemini-2.5-flash`）
   - **爬蟲快取與 Fallback 控制**
     - `SCRAPER_CACHE_TTL_HOURS`：同一帳號快取有效時數（預設 `24`）
     - `ENABLE_MOCK_FALLBACK`：Playwright 爬取受阻時是否自動切換 Mock Dataset（預設 `true`）
     - `PLAYWRIGHT_TIMEOUT_MS`：Playwright 頁面載入逾時毫秒數（預設 `30000`）
   - **預置測試帳號（選填，供 Seed 腳本使用）**
     - `SEED_TEST_USER_EMAIL` / `SEED_TEST_USER_PASSWORD`：預置評審體驗用測試帳號與密碼

4. **資料庫初始化 (Supabase Migration)**：
   將核心資料表（`users`、`threads_accounts`、`analysis_tasks`、`posts`、`aggregated_reports`）、索引與 RLS 安全政策套用至您的 Supabase 專案：
   - **方式 A（Supabase CLI）**：
     ```bash
     supabase link --project-ref <your-project-ref>
     supabase db push
     ```
   - **方式 B（Supabase Dashboard）**：
     開啟 Supabase Dashboard → **SQL Editor**，貼上並執行 `supabase/migrations/20261120000000_init_schema.sql`。

---

## 二、 如何執行 (Execution)

### 開發模式 (Development)
```bash
npm run dev
# 或
pnpm dev
```
開啟瀏覽器前往 `http://localhost:3000` 即可使用。

### Docker 一鍵啟動 (Docker)
若已安裝 Docker Desktop，可透過容器快速執行：
```bash
docker build -t threads-analyzer .
docker run -p 3000:3000 --env-file .env.local threads-analyzer
```

---

## 三、 資料來源是否合法取得 (Data Source Legality)

- **資料來源**：本系統主要透過 **Playwright** 自動化模擬瀏覽器，合法抓取 Threads 公開頁面上的貼文資訊。
- **合法性與備案說明**：因應 Meta / Threads 頻繁更新前端 DOM 結構與反爬蟲限制，本專案內建完善的 **Fallback Mock Dataset 機制**。當爬取受阻或受限時，系統將自動採用高擬真的模擬資料集進行後續數據分析與儀表板展示，確保評審與使用者在任何網路或防禦環境下皆能穩定體驗完整功能。

---

## 四、 分析指標定義 (Metrics Definition)

1. **總互動數 (Total Interactions)**：
   $$\text{Total Interactions} = \text{Likes} + \text{Replies} + \text{Reposts} + \text{Quotes}$$
   （於資料庫層級透過 Generated Column `total_engagement` 自動計算，作為綜合互動表現排序的核心指標）。
2. **平均每篇互動 (Average Engagement per Post)**：
   總互動數除以收錄貼文總數（預設至少 30 篇）。
3. **貼文分類類型 (Content Mix)**：
   依據貼文特徵分為純文字、含連結、含 hashtag、含 mention 等類型。
4. **NLP 成敗原因分群分析 (NLP Grouping & Insights)**：
   根據按讚與回覆指標將貼文分為高／中／低三大互動群組（`high` / `medium` / `low`），並針對各組抽樣 3–5 篇貼文萃取內文語意，透過 LLM 歸納出成功吸引互動或成效較低的核心原因。

---

## 五、 已知限制 (Known Limitations)

1. **動態 DOM 變動影響**：Threads 網頁前端結構若經常變動，Playwright 選擇器可能需進行對應維護。
2. **曝光數欄位限制**：因 Threads 公開網頁未提供準確的曝光數數據，曝光數欄位（`view_count`）採可選 (Nullable) 設計，主要以實質互動數（Like / Reply / Repost / Quote）進行深度分析。
3. **速率限制 (Rate Limit)**：短時間內頻繁對單一帳號發起爬取可能觸發平台防護，系統已實作快取與 Retry 機制予以緩解。
4. **快取以使用者為隔離單位 (Per-User Cache)**：基於 RLS 嚴格資料隔離原則，不同登入帳號對同一 Threads 帳號的快取彼此獨立，無法跨使用者共享爬取結果（預設效期由 `SCRAPER_CACHE_TTL_HOURS` 控制）。
5. **歷史快照儲存與 Service Role 依賴**：貼文去重約束設於單一分析任務內（`(task_id, post_url)`），同一帳號於快取過期後重新分析會保留歷史版本快照；此外，後端批次寫入或執行 Seed 腳本時須透過 `SUPABASE_SERVICE_ROLE_KEY` 執行。
6. **信箱驗證設定限制**：若 Supabase 專案後台啟用「Confirm email」，需於 Supabase Authentication 的 Redirect URLs 加入 `${NEXT_PUBLIC_SITE_URL}/auth/callback`；本地快速測試時建議先關閉 Confirm email 或直接使用預置測試帳號登入。