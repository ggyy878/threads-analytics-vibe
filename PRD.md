# 產品需求規格書 (PRD)：Threads 帳號貼文爬取與數據分析工具

> **專案名稱**：`threads-analytics-vibe`  
> **文件版本**：v1.0（最終交付同步版）  
> **最後更新日期**：2026-11-21  
> **技術架構**：Next.js 16.4.6 (App Router + Turbopack) / React 19.3 / TypeScript 5 / Tailwind CSS 4.3 / Supabase (`@supabase/ssr`, PostgreSQL + RLS) / Playwright 1.65 + Mock Fallback / Gemini 3.8 Flash (`@google/genai`) / Recharts 3.11 / Vitest 5.1 / Docker & Vercel

---

## 1. 產品目標與問題定義

- **產品目標**：協助內容團隊、品牌行銷與社群營運人員，只需輸入任一公開 Threads 帳號名稱或個人頁 URL，即可自動蒐集近期至少 30 篇貼文，完成資料清理、基礎文字特徵提取、互動三群組（高／中／低）分類與 LLM 語意成敗分析，並在互動式儀表板中呈現關鍵 KPI、視覺化圖表、多帳號並排比較與可執行策略建議。
- **目標使用者**：社群運營團隊、內容行銷企劃、品牌數據分析師。
- **核心解決痛點**：
  1. 人工複製整理 Threads 貼文數據耗時，且難以系統化量化「高互動貼文」與「低互動貼文」的文字特徵差異。
  2. Threads 公開頁面缺乏穩定曝光數且具動態 DOM 與登入牆限制，傳統單軌爬蟲極易中斷。
  3. 缺乏將「量化互動指標」與「質化文案 Hook／成敗歸因」整合在同一儀表板的工具。
- **本次不處理範圍（Out of Scope）**：
  - 即時串流監控（Real-time Streaming）與 Webhook 主動推播。
  - 自動化排程發文與代管帳號互動操作。
  - 跨社群平台（Instagram / Facebook / X）原生整合。
  - 破解或繞過私人帳號權限之資料抓取。

---

## 2. 功能規格與開發同步釐清

### 2.1 使用者認證與權限控制（Auth & Route Protection）
- **認證機制**：採用 Supabase Auth 搭配 `@supabase/ssr`，透過 Next.js Server Actions（`src/app/login/actions.ts`）實作 Email + Password 註冊、登入、登出，並以 `/auth/callback`（`src/app/auth/callback/route.ts`）處理信箱驗證回調（`exchangeCodeForSession`）。
- **Next.js 16 路由保護**：
  - 因應 Next.js 16 規範，採用 `src/proxy.ts`（搭配 `src/utils/supabase/middleware.ts`）刷新 Session，並於路由層與 Server Component 雙重呼叫 `supabase.auth.getUser()` 驗證身分。
  - **雙向導向規則**：未登入訪問 `/dashboard` 自動重導向 `/login`；已登入訪問 `/login` 自動重導向 `/dashboard`。
  - **預渲染相容性**：`/dashboard` 頁面使用 `next/server` 的 `await connection()` 搭配 `<Suspense>` 包覆，避免 `@supabase/ssr` 底層於靜態預渲染階段觸發不穩定時間值錯誤。
- **註冊防呆與評審測試便利性（開發期間新增）**：
  - 註冊流程內建信箱網域驗證，阻擋常見無效／測試假網域（如 `@example.com`），並將 Supabase 錯誤訊息轉譯為繁體中文提示。
  - 登入頁面提供**一鍵填入測試帳號按鈕**，預設評審測試帳號為 `demo@gmail.com` / `DemoPassword123!`。

### 2.2 Threads 貼文資料取得與雙軌備援（Crawler & Mock Fallback）
- **輸入規格**：支援輸入 `username`、`@username`、`https://www.threads.net/@username` 與 `https://www.threads.com/@username`，由 `src/lib/crawler/utils.ts` 自動正規化。
- **擷取欄位與數量**：單次目標擷取至少 30 篇公開貼文，包含 `external_post_id`、`post_url`、`posted_at`、`content`、`like_count`、`reply_count`、`repost_count`、`quote_count`、`view_count`（Nullable）及媒體標記。
- **曝光數欄位規格調整**：因 Threads 公開網頁無法穩定取得貼文曝光數，`view_count` 定義為 **Nullable（可選欄位）**，全系統統一改以「總互動數 `total_engagement`」作為核心排序與分群指標。
- **雙軌取得與自動降級機制（`src/lib/crawler/index.ts`）**：
  - 環境變數 `ENABLE_MOCK_FALLBACK="true"` 時，直接跳過 Playwright，回傳本地高擬真資料集（`data/mock_threads_posts.json`，共 30 篇繁體中文貼文，高／中／低三群組各 10 篇），適用於 Demo 與 Vercel Serverless 環境。
  - `ENABLE_MOCK_FALLBACK="false"` 時，優先以無頭 Chromium（Playwright）執行爬取（攔截字型與影音加速、隨機滾動與延遲防封鎖，受 `PLAYWRIGHT_TIMEOUT_MS` 控管，預設 `30000` ms）；遇登入牆（`LOGIN_WALL`）、反爬蟲挑戰（`ANTI_BOT_BLOCKED`）、帳號無法存取（`ACCOUNT_NOT_FOUND`）或超時且擷取為 0 篇時，自動降級回傳 Mock Dataset 並記錄 `is_fallback_used = true` 與 `fallback_reason`。
- **Mock 多帳號差異化（開發期間新增）**：觸發 Mock Fallback 時，依據查詢帳號名稱自動套用確定性倍率差異（Account Multiplier）並改寫 `username` 與 `post_url`，使不同查詢帳號在「多帳號比較圖表」中呈現具辨識度且穩定的數據差異。

### 2.3 資料清理、三群組分群與 NLP 語意分析（Analyzer & API）
- **資料清理與特徵提取（`src/lib/analyzer/dataCleaner.ts`）**：
  - **去重機制**：以 `external_post_id` 與正規化 `post_url` 判重，重複時保留互動數較高或內文較完整者；數值欄位負值防呆歸零。
  - **時區統一**：資料庫寫入統一採 ISO 8601 UTC（`TIMESTAMPTZ`）；分析彙總時透過 `Intl.DateTimeFormat` 轉換為 `Asia/Taipei`，統計 24 小時、四時段（凌晨／上午／下午／晚間）與星期發文分布。
  - **文字與互動特徵**：萃取 `char_count`（字數）、`hashtags`、`mentions`、`url_count`、`has_question`（問號與中文疑問詞偵測）、`has_media`、`media_type`、`reply_ratio`（回覆佔比），以及互動率（優先採 `view_count`，若為 `null` 則自動改以 `follower_count` 計算）。
- **三群組分群與抽樣策略（`src/lib/analyzer/nlpAnalyzer.ts`）**：
  - 依 `total_engagement`（同分依 `reply_count`、`like_count` 次排序）由高至低切分為高（`high`）、中（`medium`）、低（`low`）三個互動群組，並計算記錄 `high_tier_threshold` 與 `low_tier_threshold`。
  - 每組抽樣 3–5 篇代表性貼文（預設 4 篇）標記為 `is_nlp_sample = true`，送入 LLM 進行結構化語意歸納。
- **LLM 語意成敗分析與高可用降級鏈**：
  - 使用官方 `@google/genai` SDK，主模型採用 **`gemini-3.8-flash`**（可透過環境變數 `LLM_MODEL` 設定），搭配 `responseMimeType: "application/json"` 與嚴格 `responseSchema`（Structured Outputs）產出繁體中文報告。
  - 產出結構包含：整體表現摘要、高表現成功因素與 Hook 句型拆解（附佐證 `post_id`）、低表現成因歸納、跨群組數據觀察、P0–P2 可執行策略建議（含示範文案 Hook）及單篇貼文洞察（`nlp_post_insights`）。
  - **高可用降級鏈（開發期間新增）**：為因應免費版 API 尖峰流量 `503 UNAVAILABLE` 與 Vercel 60 秒超時上限，實作多模型自動降級鏈（`gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`），每次呼叫具 18 秒逾時保護；若所有 LLM 皆不可用，自動啟用統計規則引擎（`buildRuleBasedFallbackAnalysis`）兜底產出洞察，確保分析流程 100% 不中斷。
- **後端 API 與快取機制**：
  - `POST /api/analyze`（`src/app/api/analyze/route.ts`）：驗證登入身分 → 檢查該使用者針對此帳號於快取效期內（預設 24 小時，可透過 `force_refresh: true` 強制重抓）是否已有 `completed` 報告 → 命中快取時直接回傳並寫入 `data_source = 'cache'`、`cache_hit = true` 稽核紀錄；未命中則依序執行爬蟲／降級、資料清理、NLP 分析、寫入 Supabase，並同步輸出本地 `reports/` 之 JSON 與 Markdown 報告（於唯讀 Serverless 環境自動略過不報錯）。
  - `GET /api/reports`（`src/app/api/reports/route.ts`）：查詢目前登入使用者之歷史分析報告清單與單一報告明細，供儀表板切換檢視與多帳號比較使用。

### 2.4 前端數據儀表板、多帳號比較與報表匯出（Dashboard UI）
- **核心元件架構（`src/components/dashboard/`）**：
  - `AnalyzeForm.tsx`：輸入 Threads 帳號／URL、支援強制重新整理選項與即時狀態回饋。
  - `KpiCards.tsx`：總覽關鍵指標卡片（分析貼文總數、總互動數、平均每篇互動、互動中位數、高互動門檻、資料來源／Fallback／快取狀態標示）。
  - `DashboardCharts.tsx`（Recharts 3.11）：至少包含三群組互動表現比較圖、發文時段／星期互動分布圖等視覺化圖表。
  - `TopPostsTable.tsx`：高互動 Top Posts 排序表格，呈現貼文摘要、讚／回覆／轉發／引用、總互動數、分群標籤、NLP 抽樣標記與原文連結。
  - `AiInsightsSection.tsx`：結構化呈現 Gemini NLP 產出之總覽摘要、高表現成功模式與 Hook、低表現痛點診斷與 P0–P2 優先級行動建議。
  - `AccountComparison.tsx`：支援同時勾選 **2 個以上** 已分析帳號進行 KPI 與圖表並排對比。
  - `DashboardClient.tsx`：整合歷史報告切換、資料正規化（`src/lib/normalize-report.ts`）與匯出功能（`src/lib/export-report.ts`，支援前端一鍵下載 **CSV / JSON** 報表）。

---

## 3. 使用者流程 (User Flow)

1. **進入系統與認證**：使用者開啟首頁或 `/dashboard`，未登入者由 `src/proxy.ts` 自動導向 `/login`。
2. **登入／註冊**：使用評審測試帳號（一鍵填入 `demo@gmail.com` / `DemoPassword123!`）或輸入有效網域 Email 註冊登入。
3. **發起帳號分析**：於 `/dashboard` 的 `AnalyzeForm` 輸入目標 Threads 帳號或 URL 送出分析。
4. **快取檢查與雙軌分析**：後端優先檢查 Per-User 快取；未命中則啟動 Playwright 爬取（受阻自動降級 Mock）→ 資料清理與分群 → Gemini 3.8 Flash 語意分析 → 寫入 Supabase。
5. **檢視洞察與互動操作**：在儀表板檢視 KPI 卡片、Recharts 圖表、Top Posts 表格與 AI 策略建議（若有降級或快取命中，介面清楚標示來源）。
6. **進階比較與匯出**：分析第 2 個以上帳號後，於多帳號比較區塊勾選並排對比，並可一鍵匯出 CSV / JSON 分析報表。

---

## 4. 資料模型與權限隔離（Supabase Schema & RLS）

完整 DDL 位於 `supabase/migrations/20261120000000_init_schema.sql`，採正規化 5 張核心表與 3 個自訂 PostgreSQL ENUM（`task_status`、`data_source_type`、`engagement_tier_type`）：

| 資料表 | 核心用途與關鍵欄位設計 |
| :--- | :--- |
| `public.users` | 使用者基本資料；透過 `on_auth_user_created` Trigger（`SECURITY DEFINER` + `SET search_path = public`）於註冊時自動同步 `auth.users`，含 `is_test_account` 標記。 |
| `public.threads_accounts` | 使用者追蹤的 Threads 帳號主檔；紀錄正規化 `username`、個人頁 URL、`last_scraped_at` 與 `cache_expires_at` 支撐帳號層級快取與多帳號比較。 |
| `public.analysis_tasks` | 單次分析任務生命週期與稽核紀錄；包含 `status`、`data_source`（`playwright` / `mock_fallback` / `cache`）、`is_fallback_used`、`fallback_reason`、`cache_hit`、`cached_from_task_id`。 |
| `public.posts` | 清理後之貼文數據；含 `view_count`（Nullable）、PostgreSQL Generated Column `total_engagement`（自動彙算 `like_count + reply_count + repost_count + quote_count`）、文字特徵欄位、`engagement_tier`（`high` / `medium` / `low`）、`is_nlp_sample`、`raw_payload`，並透過 `(task_id, post_url)` 與部分唯一索引 `(task_id, external_post_id)` 確保單一任務內自動去重。 |
| `public.aggregated_reports` | 任務彙總 KPI、三群組門檻與統計快照（`chart_snapshots`）、Gemini Structured Outputs 結構化分析結果與使用模型紀錄。 |

- **Row Level Security (RLS) 安全策略**：
  - 5 張資料表全面啟用 RLS，匿名角色（`anon`）完全禁止讀寫。
  - 已認證使用者（`authenticated`）僅能透過 `auth.uid() = user_id` 存取自身資料。
  - `analysis_tasks`、`posts`、`aggregated_reports` 的寫入政策額外加入 `EXISTS` 父層外鍵歸屬驗證，防止跨帳號帶入他人 `account_id` 或 `task_id` 越權寫入。

---

## 5. 例外情境與降級保護行為

| 例外情境 | 系統處理與降級行為 |
| :--- | :--- |
| **Threads 登入牆／反爬蟲阻擋／帳號不存在** | `threadsScraper.ts` 拋出結構化錯誤（`LOGIN_WALL` / `ANTI_BOT_BLOCKED` / `ACCOUNT_NOT_FOUND`），由 `index.ts` 攔截並自動切換至 `data/mock_threads_posts.json` 進行分析，寫入 `is_fallback_used = true` 與 `fallback_reason` 供前端提示。 |
| **Playwright 達超時上限（`PLAYWRIGHT_TIMEOUT_MS`）** | 若超時前已成功擷取至少 1 篇貼文，則優雅結束並保留實抓成果；若擷取為 0 篇，自動降級回傳 Mock Dataset。 |
| **Gemini API 速率限制（429）或尖峰過載（503）** | 依序嘗試多模型降級鏈（`gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`），單次限制 18 秒超時；若仍失敗則由統計規則兜底產出結構化洞察，不回傳 500 錯誤。 |
| **Vercel Serverless 唯讀檔案系統** | 本地執行時同步將報告輸出至 `reports/`；於 Vercel 唯讀環境寫檔失敗時自動靜默降級略過，不影響資料庫寫入與前端回傳。 |
| **前端非法輸入或假信箱註冊** | 註冊表單攔截 `@example.com` 等無效網域；儀表板資料層透過 `normalize-report.ts` 進行欄位容錯，避免缺值導致畫面崩潰或 SSR Hydration 不一致。 |

---

## 6. 驗收標準 (Acceptance Criteria - Given / When / Then)

1. **使用者認證與權限隔離**
   - **Given** 未登入訪客嘗試存取 `/dashboard`，**When** 送出頁面請求，**Then** 系統經由 `src/proxy.ts` 自動導向 `/login`；使用 `demo@gmail.com` / `DemoPassword123!` 登入後，可正常進入 `/dashboard` 且僅能查詢屬於自己 `user_id` 的報告資料。
2. **Threads 資料抓取與自動降級**
   - **Given** 已登入使用者輸入有效 Threads 帳號或 URL，**When** 點擊開始分析，**Then** 系統於 60 秒內完成爬取（或於遇登入牆／反爬蟲／`ENABLE_MOCK_FALLBACK="true"` 時無縫降級至 30 篇 Mock 資料），正確清理去重並標示資料來源。
3. **三群組分群、NLP 分析與快取**
   - **Given** 系統取得清理後的貼文資料，**When** 執行分析管線，**Then** 正確以 `total_engagement` 分為高／中／低三組、每組抽樣 3–5 篇呼叫 Gemini 3.8 Flash（含降級鏈）產出結構化繁體中文洞察，並於 24 小時內再次查詢同一帳號時命中快取回傳。
4. **儀表板、多帳號比較與匯出**
   - **Given** 使用者完成至少 2 個不同帳號的分析，**When** 進入儀表板並於比較區勾選多個帳號，**Then** 畫面正確呈現 KPI 卡片、至少 2 張 Recharts 圖表、Top Posts 表格、AI 策略建議與多帳號並排比較圖表，並可成功匯出 CSV 與 JSON 檔案。
5. **自動化測試與容器／雲端部署**
   - **Given** 專案程式碼與部署設定檔就緒，**When** 執行 `npm test`、`npm run build` 或透過 `Dockerfile`／`vercel.json` 建置部署，**Then** Vitest 單元測試全數通過、TypeScript 零錯誤，且容器與 Vercel `/api/analyze`（`maxDuration: 60`）皆可正常運行。

---

## 7. 非功能需求 (NFR)

- **安全性**：全密鑰（`SUPABASE_SERVICE_ROLE_KEY`、`GEMINI_API_KEY` / `LLM_API_KEY`）僅於後端環境變數載入並由 `.gitignore` / `.dockerignore` 排除；資料庫全面啟用 Supabase RLS 隔離不同使用者資料。
- **效能與逾時控管**：透過帳號層級 24 小時快取減少重複爬取與 LLM Token 消耗；Vercel Serverless Function 設定 `maxDuration: 60` 搭配 LLM 單次 18 秒超時保護，避免請求卡死。
- **可維護性與可移植性**：模組清楚拆分（`crawler/`、`analyzer/`、`dashboard/`、`utils/supabase/`），附帶 Vitest 核心邏輯單元測試、多階段 `Dockerfile`（Node 22 + Playwright Chromium）與 `vercel.json` 一鍵部署設定。

---

## 8. 開發階段拆解與完成狀態（Phase 0 – Phase 8）

| 優先級 | 階段 | 對應內容 | 狀態 |
| :--- | :--- | :--- | :--- |
| **Must (P0)** | Phase 0 – Phase 2 | PRD 定案、Supabase Schema/RLS Migration、Email Auth 與 Next.js 16 路由保護 | 已完成 |
| **Must (P0)** | Phase 3 – Phase 4 | Playwright 爬蟲與 Mock Fallback、資料清理、三群組分群、Gemini 3.8 Flash NLP 與 `/api/analyze` | 已完成 |
| **Should (P1)** | Phase 5 – Phase 6 | 儀表板 KPI 卡片、Recharts 圖表、Top Posts、AI 洞察、多帳號比較、登入體驗強化與 CSV/JSON 匯出 | 已完成 |
| **Could (P2)** | Phase 7 – Phase 8 | Vitest 單元測試、多階段 `Dockerfile`、`vercel.json` 部署設定、全專案文件同步校正 | 已完成 |