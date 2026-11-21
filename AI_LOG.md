# AI_LOG.md - Vibe Coding 開發日誌

文件記錄本專案在 AI 協作 (Vibe Coding) 過程中的提示詞互動、架構演進、驗證方式與幻覺修正紀錄。

---

## Checkpoint 0：專案初始化與規格定案
- **日期**：2026-11-20
- **記錄重點**：
  1. **需求描述與拆解**：
     - 與 AI 溝通考題要求（Threads 爬蟲、Supabase 認證與 RLS、NLP 分群成敗分析、多帳號比較、Docker 與 Vercel 部署）。
     - 確立 35 個工作單位（17.5 小時）的時間評估與 3 帳戶輪替策略。
  2. **規格釐清與決策**：
     - 針對曝光數無法取得的問題，採 **Nullable 欄位並以總互動數替代** 的方案。
     - 針對爬蟲不穩定性，確認 **Playwright + Fallback Mock Dataset** 雙軌並行機制。
     - 確定 NLP 分析採 **LLM 結構化 Prompt 語意歸納**。
  3. **產出檔案**：
     - 建立 `PRD.md`、`README.md` 與 `AI_LOG.md`。
     - 完成 Git 專案初始化與第一次 Commit。


## Checkpoint 1：Supabase Schema、RLS 與環境變數初始化（`feat/init-supabase`）
- **開發重點與技術選型**：
  1. **資料模型正規化（5 張核心表）**：
     - 依 PRD 建立 `users`、`analysis_tasks`、`posts`、`aggregated_reports`，並額外拆分 `threads_accounts` 獨立管理追蹤帳號與快取有效期限（`last_scraped_at`、`cache_expires_at`），以支撐多帳號並排比較與帳號層級快取檢查。
     - 採用自訂 PostgreSQL ENUM（`task_status`、`data_source_type`、`engagement_tier_type`）約束任務狀態、資料來源與三群組分類，減少應用程式層字串誤植風險。
     - `posts.view_count` 設為 Nullable，並以 PostgreSQL Generated Column（`total_engagement`）自動彙算 `like + reply + repost + quote`，搭配降冪索引加速 Top Posts 排序查詢。
  2. **安全性與資料隔離（RLS & Auth 同步）**：
     - 5 張核心表全面啟用 Row Level Security（RLS），僅允許 `authenticated` 角色透過 `auth.uid() = user_id` 存取自身資料。
     - 建立 `on_auth_user_created` Trigger（`SECURITY DEFINER` 並固定 `search_path = public`），在 Supabase Auth 註冊後自動寫入 `public.users`。
  3. **快取、Fallback 與去重設計**：
     - `analysis_tasks` 納入 `data_source`、`is_fallback_used`、`fallback_reason`、`cache_hit` 與 `cached_from_task_id`，完整記錄爬蟲切換 Mock 或命中快取的狀態。
     - `posts` 透過 `(task_id, post_url)` 與部分唯一索引 `(task_id, external_post_id)` 確保單一任務內自動去重，並以 `TIMESTAMPTZ` 統一處理時區。
  4. **除錯與防呆設計紀錄**：
     - **防跨帳號外鍵越權寫入**：在 `analysis_tasks`、`posts`、`aggregated_reports` 的 `INSERT` RLS 政策中補上 `EXISTS` 檢查，防止惡意請求帶入他人 `account_id` 或 `task_id`。
     - **Migration 冪等性與安全性**：ENUM 建立改用 `DO $$ ... IF NOT EXISTS` 區塊避免重複執行報錯；`handle_new_user()` 明確鎖定 `SET search_path = public` 以防範 Postgres `SECURITY DEFINER` search path 風險。
     - *(若本地或 Supabase SQL Editor 執行 Migration 時有遇到其他報錯，可於合併前補充於此)*
  5. **產出檔案**：
     - `supabase/migrations/20261120000000_init_schema.sql`

     ---

## Checkpoint 2：使用者認證模組（Branch: `feat/auth`）
- **記錄重點**：
  1. **技術選型與架構設計**：
     - 採用官方推薦套件 `@supabase/ssr` 與 `@supabase/supabase-js`，建立瀏覽器端（`src/utils/supabase/client.ts`）、伺服器端（`src/utils/supabase/server.ts`）與 Session 刷新邏輯（`src/utils/supabase/middleware.ts`）。
     - 使用 Next.js Server Actions（`src/app/login/actions.ts`）處理 Email + Password 註冊、登入與登出流程，並將常見 Supabase 錯誤訊息轉譯為繁體中文提示。
     - 新增 `/auth/callback`（`src/app/auth/callback/route.ts`）處理註冊信箱驗證後的 `exchangeCodeForSession`。
     - 於路由層與 Server Component 層皆透過 `supabase.auth.getUser()` 進行雙重驗證，確保 Session 安全性。
  2. **路由保護與 UI 實作**：
     - 實作雙向路由保護：未登入訪問 `/dashboard` 自動導向 `/login`；已登入訪問 `/login` 自動導向 `/dashboard`。
     - 建立登入/註冊切換介面（`src/app/login/page.tsx`）、登出按鈕元件（`src/components/SignOutButton.tsx`）與受保護的 `/dashboard` 基礎頁面（`src/app/dashboard/page.tsx`），包含 `useTransition` Loading 狀態。
  3. **除錯與 Next.js 16 相容性修正紀錄**：
     - **Middleware 命名變更**：專案使用 Next.js `16.4.6`，將傳統 `src/middleware.ts` 調整為新版規範 `src/proxy.ts`（匯出 `proxy` 函式），避免棄用警告。
     - **解決 `Blocking Route` 預渲染錯誤**：`/dashboard` 執行時觸發 `Next.js encountered the unstable value Date.now() while prerendering`，主因為 `@supabase/ssr` 底層 `GoTrueClient` 在宣告動態請求前即呼叫 `Date.now()`。最終於 `src/app/dashboard/page.tsx` 導入 `next/server` 的 `await connection()` 並以 `<Suspense>` 包覆非同步內容，成功排除錯誤。


---

## Checkpoint 3：Threads 爬蟲與 Mock Fallback 模組（Branch: `feat/threads-crawler`）
- **記錄重點**：
  1. **高擬真 Fallback Mock Dataset（`data/mock_threads_posts.json`）**：
     - 建置 30 篇繁體中文 Threads 貼文樣本（高、中、低互動三群組各 10 篇，總互動數分布為 `635–1,588`、`141–286`、`13–48`），涵蓋不同發文時間、字數長度、問句互動、純文字／圖片／輪播標記及 `view_count: null` 案例。
     - 欄位結構完全對齊 `public.posts` 資料表，並刻意排除資料庫自動計算之 `total_engagement` Generated Column。
  2. **Playwright 爬蟲與工具模組（`src/lib/crawler/`）**：
     - `types.ts` / `utils.ts`：定義對齊 `threads_accounts`、`analysis_tasks`、`posts` 的 TypeScript 介面與 `ThreadsCrawlerError`；實作帳號正規化（相容 `username`、`@username`、`threads.net` 與 `threads.com`）、文字特徵抽取、簡寫數字解析（`K`/`M`/`萬`）、隨機延遲、貼文去重與 `toSupabasePostInsertRows()` 轉換。
     - `threadsScraper.ts`：採用動態 `import("playwright")` 啟動無頭 Chromium，攔截字型與影音請求加速載入；加入隨機滾動幅度與延遲防封鎖，並讀取 `PLAYWRIGHT_TIMEOUT_MS` 控管整體爬取逾時，同時偵測登入牆（`LOGIN_WALL`）、反爬蟲挑戰（`ANTI_BOT_BLOCKED`）與私人／不存在帳號（`ACCOUNT_NOT_FOUND`）。
     - `index.ts`：實作自動降級封裝層 `crawlThreadsPosts()`；當 `ENABLE_MOCK_FALLBACK="true"` 時直接回傳 Mock 資料，設為 `"false"` 時則優先以 Playwright 爬取，遇任何阻擋或異常自動深拷貝並切換回傳 `data/mock_threads_posts.json`，同時回傳 `data_source`、`is_fallback_used`、`fallback_reason` 供寫入 `analysis_tasks`。
     - `scripts/test-crawler.ts`：建立本地煙霧測試腳本，完成 Mock 模式與 Playwright 真實爬取／自動降級兩組情境驗證。
  3. **除錯與相容性修正紀錄**：
     - **Playwright 瀏覽器安裝指令修正**：執行 `npx exec playwright install chromium` 出現 `could not determine executable to run`，修正為 `npx playwright install chromium`。
     - **PowerShell `@` 參數展開錯誤**：傳入 `@taipei_pm_notes`／`@zuck` 未加引號時被 PowerShell 誤判為 Splatting 變數展開，改以雙引號包覆（`"@zuck"`）解決。
     - **強化錯誤降級型別判斷**：修復測試 B 觸發 `TypeError: Right-hand side of 'instanceof' is not an object` 問題，確保 `types.ts` 匯出 `ThreadsCrawlerError` 並於 `index.ts` 改以結構化守衛函式 `isCrawlerErrorLike()` 取代單純 `instanceof`，確保降級保護絕不中斷。
     - **語法修復**：修正手動調整 `catch` 區塊時遺漏函式大括號導致的 esbuild `Unexpected "export"` 編譯錯誤。
  4. **產出檔案**：
     - `data/mock_threads_posts.json`
     - `src/lib/crawler/types.ts`、`src/lib/crawler/utils.ts`、`src/lib/crawler/threadsScraper.ts`、`src/lib/crawler/index.ts`
     - `scripts/test-crawler.ts`

---

## Checkpoint 4：資料清理、NLP 成敗分析與後端 API 整合（Branch: `feat/nlp-analysis`）
- **日期**：2026-11-21
- **記錄重點**：
  1. **資料清理與特徵提取模組（`src/lib/analyzer/dataCleaner.ts`）**：
     - 實作貼文去重邏輯（依 `external_post_id` 與正規化 `post_url` 判重，重複時優先保留互動數較高或內文較完整者）。
     - 統一時間處理：寫入 Supabase `TIMESTAMPTZ` 維持 ISO 8601 UTC 格式，同時透過 `Intl.DateTimeFormat` 轉換為 `Asia/Taipei` 統計 24 小時、四時段（凌晨／上午／下午／晚間）與星期分布。
     - 提取基礎文字與互動特徵：`char_count`、`hashtags`、`mentions`、`url_count`、`has_question`（問號與中文疑問詞偵測）、`has_media`、`media_type`、`reply_ratio`，以及互動率（優先採 `view_count`，若為 `null` 則自動改以 `follower_count` 計算），並彙算平均值、中位數與前端繪圖用 `chart_snapshots`。
  2. **三群組分群與 Gemini Structured Outputs 分析模組（`src/lib/analyzer/nlpAnalyzer.ts`）**：
     - 依 `total_engagement`（同分依 `reply_count`、`like_count` 次排序）自動劃分為高（`high`）、中（`medium`）、低（`low`）三群組，記錄 `high_tier_threshold` 與 `low_tier_threshold`，每組抽樣代表性貼文（預設 4 篇，上限 3–5 篇）並標記 `is_nlp_sample = true`。
     - 安裝官方 `@google/genai` SDK，透過 `responseMimeType: 'application/json'` 與嚴格 `responseSchema`（Structured Outputs）產出繁體中文結構化分析：總覽摘要、高表現成功因素與 Hook 句型拆解（附佐證 `post_id`）、低表現成因、跨群組數據觀察、P0–P2 可執行策略建議（含示範 Hook），以及回寫至單篇貼文的 `nlp_post_insights`。
  3. **後端整合 API 路由與報告輸出（`src/app/api/analyze/route.ts`）**：
     - 透過 Supabase Server Client 執行 `supabase.auth.getUser()` 驗證登入狀態，未登入回傳 `401`。
     - 實作帳號層級快取機制：檢查 `SCRAPER_CACHE_TTL_HOURS`（預設 24 小時）內是否已有 `completed` 分析報告，命中時直接回傳既有 `aggregated_reports` 與 `posts`，並於 `analysis_tasks` 補寫 `data_source = 'cache'`、`cache_hit = true` 之稽核紀錄（支援請求帶入 `force_refresh: true` 強制重跑）。
     - 串接完整非同步分析管線：`crawlThreadsPosts`（含自動 Retry）→ 資料清理與分群 → Gemini NLP 分析 → 寫入 `posts`（避開 PostgreSQL `GENERATED ALWAYS` 之 `total_engagement` 欄位）與 `aggregated_reports` → 更新任務狀態（`scraping` → `analyzing` → `completed` / `failed`）→ 同步輸出 Markdown 與 JSON 報告至 `reports/` 資料夾（於唯讀 Serverless 環境自動降級略過不中斷主流程）。
  4. **除錯、模型遷移與韌性強化紀錄**：
     - **Supabase 模組路徑與 TypeScript 型別修正**：修正 AI 初版預設路徑 `@/lib/supabase/server` 為專案實際路徑 `@/utils/supabase/server`；修復報告 Markdown 樣板字串內未跳脫反引號（`` `high_tier_threshold` `` / `` `low_tier_threshold` ``）與 `activeTaskId`（`string | null`）型別收窄問題，改以區域常數 `taskId: string` 傳遞。
     - **Phase 3 爬蟲模組對接修正**：初次測試回傳 `500`（找不到爬蟲匯出函式）；檢視 `src/lib/crawler/index.ts` 後改為靜態具名匯入 `crawlThreadsPosts(username, { targetPostCount })`，並清除替換過程殘留的舊版轉接程式碼。
     - **Gemini 模型下線（`404 NOT_FOUND`）遷移**：原規劃呼叫 `gemini-2.5-flash`，實測時 Google API 回傳 `404`（新使用者已無法使用該模型）。依官方回應升級為 `gemini-3.8-flash`（支援 `.env.local` 設定 `GEMINI_MODEL` 覆寫），移除 Gemini 3.x 不建議傳入的 `temperature` 參數，並將 `NOT_FOUND` 列為不重試錯誤。
     - **尖峰流量 `503 UNAVAILABLE` 與 Serverless 逾時防護**：實測遭遇模型尖峰壅塞 `503`，單一模型重試 3 次耗時達 `68s` 超過 `maxDuration = 60` 上限。後續重構為多模型自動降級鏈（`gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`）、單次 `18s` 逾時保護（`withTimeout`）與最終統計規則降級兜底（`buildRuleBasedFallbackAnalysis`），並修復重構時遺漏的 `insightByPostId` Map 宣告。
     - **端對端驗證**：透過瀏覽器 Console 呼叫 `POST /api/analyze`（`taipei_pm_notes`），驗證 Playwright 遇登入牆自動降級 Mock 資料、Gemini Structured Outputs 正常回傳 `200`、Supabase 寫入成功且 `npx tsc --noEmit` 零報錯。
  5. **產出檔案**：
     - `src/lib/analyzer/dataCleaner.ts`
     - `src/lib/analyzer/nlpAnalyzer.ts`
     - `src/app/api/analyze/route.ts`
     - `reports/taipei_pm_notes_*.md`、`reports/taipei_pm_notes_*.json`（執行後自動產生）