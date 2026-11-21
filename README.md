# Threads 帳號貼文爬取與數據分析工具

基於 **Next.js 16**、**Supabase**、**Playwright** 與 **Gemini 3.8 Flash** 的 Threads 帳號貼文爬取與數據分析儀表板，支援公開帳號／URL 貼文抓取（近期至少 30 篇）、資料清理、互動三群組（高／中／低）分類、LLM 語意成敗歸因、多帳號比較與 CSV / JSON 匯出。

## 技術棧

| 層級 | 技術規格 |
| :--- | :--- |
| 前端與全端框架 | Next.js `16.4.6`（App Router / Turbopack）、React `19.3.0`、TypeScript `^5` |
| 資料庫與驗證 | Supabase（PostgreSQL、RLS、`@supabase/ssr` `^0.12.7`、`@supabase/supabase-js` `^2.119.2`） |
| 資料抓取與備援 | Playwright `^1.65.1`（Chromium）＋ 本地 Mock Dataset 自動降級 |
| 語意分析模型 | `@google/genai` `^3.6.1`、`gemini-3.8-flash`（含多模型與規則引擎降級鏈） |
| 介面、測試與部署 | Tailwind CSS `4.3.3`、Recharts `^3.11.0`、Lucide React、Vitest `^5.1.1`、Docker、Vercel |

## 環境需求

- Node.js `>= 22.0.0`（建議使用 Node.js 22 LTS）與 `npm`
- [Supabase](https://supabase.com/) 專案（提供 PostgreSQL 與 Email 認證）
- [Google AI Studio](https://aistudio.google.com/) Gemini API Key
- （選用）Docker Desktop

## 快速開始

### 1. 安裝依賴與瀏覽器核心

```bash
git clone <repository-url>
cd threads-analytics-vibe
npm install
npx playwright install chromium
```

### 2. 建立資料庫結構（`supabase/migrations/`）

執行 `supabase/migrations/20261120000000_init_schema.sql` 建立 `users`、`threads_accounts`、`analysis_tasks`、`posts`、`aggregated_reports` 資料表與 RLS 安全政策：

- **Supabase Dashboard**：於左側 **SQL Editor** 貼上 `supabase/migrations/20261120000000_init_schema.sql` 內容並執行。
- **Supabase CLI**：執行 `supabase link --project-ref <your-project-ref>` 後執行 `supabase db push`。

### 3. 設定環境變數

```bash
cp .env.example .env.local
```

| 變數名稱 | 必填 | 預設值／範例 | 說明 |
| :--- | :---: | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | `https://xxx.supabase.co` | Supabase 專案 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 是 | `eyJ...` | Supabase 公開金鑰（`anon public`） |
| `SUPABASE_SERVICE_ROLE_KEY` | 是 | `eyJ...` | Supabase 服務金鑰（僅限後端使用，嚴禁暴露於前端） |
| `GEMINI_API_KEY` | 是 | `AIza...` | Google AI Studio Gemini API Key |
| `LLM_API_KEY` | 選填 | `AIza...` | 通用 LLM API Key 備用變數 |
| `LLM_MODEL` | 否 | `gemini-3.8-flash` | NLP 結構化分析主模型 |
| `ENABLE_MOCK_FALLBACK` | 否 | `"false"` | `"true"` 略過 Playwright 直接使用 Mock（Vercel 建議設為 `"true"`）；`"false"` 優先爬取並遇阻擋自動降級 |
| `PLAYWRIGHT_TIMEOUT_MS` | 否 | `"30000"` | Playwright 單次爬取超時上限（毫秒） |
| `SCRAPER_CACHE_TTL_HOURS` | 否 | `"24"` | 單一使用者對同一 Threads 帳號之快取有效時數（預設 24 小時） |

### 4. 啟動應用程式

預設測試帳號（可於 `/login` 頁面點擊**「一鍵填入測試帳號」**或手動輸入）：`demo@gmail.com` / `Password123!`。

```bash
# 開發模式啟動
npm run dev

# 正式環境編譯與啟動
npm run build
npm run start
```

啟動後開啟 `http://localhost:3000`（未登入將自動導向 `/login`）。

## 容器與雲端部署

### Docker 建置與執行

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="[https://你的專案.supabase.co](https://你的專案.supabase.co)" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="你的_anon_key" \
  -t threads-analytics-vibe .

docker run -p 3000:3000 --env-file .env.local threads-analytics-vibe
```

### Vercel 部署

專案已配置 `vercel.json`（設定 `/api/analyze` `maxDuration: 60`）。匯入儲存庫並填入環境變數即可部署；Vercel 環境建議將 `ENABLE_MOCK_FALLBACK` 設為 `"true"`。

## 常用指令

| 指令 | 說明 |
| :--- | :--- |
| `npm run dev` | 啟動開發伺服器 |
| `npm run build` | 編譯正式環境版本 |
| `npm run start` | 啟動正式環境伺服器 |
| `npm test` | 執行 Vitest 單元測試（`src/__tests__/analyzer.test.ts`） |
| `npm run test:watch` | 以監看模式執行單元測試 |

## 資料來源合法性聲明

- **僅解析公開頁面**：Playwright 僅針對使用者輸入之公開 Threads 帳號貼文進行前端 DOM 結構解析，絕不模擬私人登入、不破解權限，亦不蒐集非公開個人隱私資料。
- **請求頻率控制與快取**：內建隨機滾動間隔、請求延遲、`PLAYWRIGHT_TIMEOUT_MS` 超時限制與資料庫帳號快取（預設 24 小時 TTL），有效降低重複請求頻率。
- **Mock 備援與合規退場**：內建 30 篇繁體中文模擬資料集（`data/mock_threads_posts.json`）；一旦偵測到登入牆（`LOGIN_WALL`）或反爬蟲阻擋（`ANTI_BOT_BLOCKED`）即立即停止爬取並無縫切換至 Mock，絕不繞過驗證碼或違反平台使用條款。

## 分析指標定義

### 核心互動指標

由於 Threads 公開頁面無法穩定取得曝光數（`view_count` 設為 Nullable），PostgreSQL 透過 Generated Column 自動彙算總互動數：

$$\text{total\_engagement} = \text{like\_count} + \text{reply\_count} + \text{repost\_count} + \text{quote\_count}$$

- **平均每篇互動**：`total_engagement` 總和除以分析貼文篇數（預設至少 30 篇）。
- **互動中位數（Median Engagement）**：降低單一爆文極端值對整體評估的扭曲。
- **回覆佔比（`reply_ratio`）**：$\text{reply\_count} \div \text{total\_engagement}$，衡量貼文引發留言討論的深度。
- **互動率（Engagement Rate）**：具效 `view_count` 時以 `total_engagement / view_count` 計算；若 `view_count` 為 `null` 且具追蹤者數，則改以 `follower_count` 估算。

### 文字與發文特徵（`src/lib/analyzer/dataCleaner.ts`）

- **字數長度（`char_count`）**：移除首尾空白後的內文字元總數。
- **互動語氣（`has_question`）**：偵測中英文問號（`?` / `？`）或常見中文提問／號召互動詞彙。
- **社群元素**：擷取 `hashtags`、`mentions`（`@帳號`）與外部連結數（`url_count`）。
- **媒體型態**：`has_media` / `media_type`（區分純文字、單圖、輪播或影音等形式）。
- **時區與時段**：原始時間統一以 UTC（`TIMESTAMPTZ`）儲存，分析時轉換為台灣時間（`Asia/Taipei`），統計 24 小時、四時段（凌晨／上午／下午／晚間）與週一至週日平均互動表現。

### 三群組分類與 NLP 抽樣（`src/lib/analyzer/nlpAnalyzer.ts`）

- **三群組切分標準**：依 `total_engagement` 由高至低排序（同分時依 `reply_count`、`like_count` 次排序），等比例切分前 1/3 為 **高互動（`high`）**、中 1/3 為 **中互動（`medium`）**、後 1/3 為 **低互動（`low`）**，並記錄門檻值 `high_tier_threshold` 與 `low_tier_threshold`。
- **NLP 抽樣與輸出**：各群組抽樣 **3–5 篇代表性貼文（預設 4 篇，`is_nlp_sample = true`）** 送交 `gemini-3.8-flash`（JSON `responseSchema`），產出高互動成功因素與 Hook 拆解（附佐證 `post_id`）、低表現成因歸納、跨群組數據觀察與 P0–P2 內容策略建議。

## 已知限制

- **DOM 結構變動與登入牆／反爬蟲**：Threads 前端 DOM 常態性調整且未登入易觸發 `LOGIN_WALL` 或 `ANTI_BOT_BLOCKED`；遇阻擋、帳號不存在或超時時將自動降級回傳 `data/mock_threads_posts.json`（依帳號名稱套用確定性倍率差異以利多帳號比較），並標示 `is_fallback_used` 與 `fallback_reason`。
- **免費版 LLM API 速率限制**：Gemini 免費額度具 RPM／Token 限制且尖峰時段偶有 `429` 或 `503` 錯誤；系統內建多模型降級鏈（`gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`）、單次 18 秒超時保護與統計規則引擎兜底。
- **缺乏公開曝光數**：公開網頁未提供完整曝光數，`view_count` 維持 Nullable，所有核心排序與分群皆以 `total_engagement` 為準。
- **Vercel Serverless 執行限制**：因無頭瀏覽器二進位檔與唯讀檔案系統限制，部署於 Vercel 時建議設 `ENABLE_MOCK_FALLBACK="true"`；本機寫入 `reports/` 功能於 Serverless 會自動靜默略過（不影響資料庫寫入與前端匯出），`/api/analyze` 超時上限為 60 秒。
- **Per-User 快取隔離與信箱驗證**：受 Supabase RLS 隔離政策規範，不同登入帳號對同一 Threads 帳號的快取彼此獨立；註冊介面會阻擋 `@example.com` 等無效測試網域，若後台啟用「Confirm email」需於 Supabase Redirect URLs 加入 `/auth/callback`。
