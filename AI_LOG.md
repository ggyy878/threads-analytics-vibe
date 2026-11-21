# AI_LOG.md - Vibe Coding 開發日誌

本文件完整記錄 `threads-analytics-vibe` 專案從 **Phase 0 至 Phase 8** 的 AI 協作（Vibe Coding）歷程，包含向 AI 描述需求的方法、AI 產出的程式碼模組、正確性驗證流程、AI 錯誤與幻覺的修正紀錄，以及 AI 協作效益總結。

---

## 一、 分階段開發歷程（Phase 0 – Phase 8）

### Phase 0：需求釐清、規格定案與專案初始化
- **對應分支與 Commit**：`main`（`5a729ad` `chore(init): add PRD, README, and AI_LOG for Phase 0-1`）
- **階段目標**：釐清考題規格與邊界條件、訂定 PRD-First 開發流程，完成專案初始化與三份基礎文件骨架。
- **如何向 AI 描述需求**：
  - 提供完整考題需求與時間限制，請 AI 協助拆解 35 個工作單位（每單位 30 分鐘）的執行計畫，並針對模糊需求（曝光數缺失、爬蟲防封鎖、多帳號比較）討論具體技術折衷方案。
  - 明確約束開發節奏：前 6 階段專注本地開發與功能交付，第 7 階段再導入 Docker 容器化與部署設定。
- **AI 產出內容**：初版 `PRD.md`、`README.md`、`AI_LOG.md` 與專案整體架構藍圖。
- **關鍵技術決策**：
  - 因 Threads 公開頁面無法穩定取得曝光數，決議 `view_count` 設為 Nullable，並以 `total_engagement`（讚＋回覆＋轉發＋引用）作為核心排序指標。
  - 採用 **Playwright 真實爬取 + 本地高擬真 Mock Dataset 自動降級** 的雙軌架構。
  - NLP 成敗分析採用 **LLM 結構化輸出（Structured Outputs）**，避免自由文字回應導致前端解析失敗。
- **驗證方式**：人工逐項核對考題交付規範與 PRD 驗收條件，確認無遺漏核心需求後進行首次 Git Commit。

---

### Phase 1：Supabase 資料表結構、RLS 安全政策與環境變數範本
- **對應分支與 Commit**：`feat/init-supabase`（`f15ff55`, `931087e`）
- **階段目標**：設計正規化資料庫 Schema、建置嚴格 RLS 資料隔離與 Auth 使用者同步 Trigger。
- **如何向 AI 描述需求**：
  - 將 `PRD.md` 的資料流貼給 AI，要求設計具備「多帳號比較」、「帳號層級快取（TTL）」與「Fallback 稽核紀錄」的 PostgreSQL Migration SQL，並要求全表啟用 RLS 與防跨帳號越權寫入檢查。
- **AI 產出程式碼**：
  - `supabase/migrations/20261120000000_init_schema.sql`（5 張核心表：`users`、`threads_accounts`、`analysis_tasks`、`posts`、`aggregated_reports`；3 個自訂 ENUM；`total_engagement` Generated Column；`on_auth_user_created` Trigger；完整 RLS 政策）
  - `.env.example` 環境變數範本
- **如何驗證正確性**：
  - 將 Migration SQL 實際貼入 Supabase Dashboard SQL Editor 執行，驗證資料表、索引、Generated Column、Trigger 與 RLS 政策皆成功建立且無語法報錯。
- **修正 AI 的錯誤或安全補強**：
  - **跨帳號外鍵越權防護**：檢查 AI 初版 RLS 政策時發現僅驗證 `auth.uid() = user_id`，主動要求於 `analysis_tasks`、`posts`、`aggregated_reports` 的 `INSERT` 政策補上 `EXISTS` 父層歸屬檢查，避免惡意請求帶入他人 `account_id` / `task_id`。
  - **Migration 冪等性與 Security Definer 風險**：將 `CREATE TYPE` 改以 `DO $$ ... IF NOT EXISTS` 包覆避免重複執行報錯，並在 `handle_new_user()` 強制加上 `SET search_path = public`。

---

### Phase 2：使用者認證模組與 Next.js 16 路由保護
- **對應分支與 Commit**：`feat/auth`（`f1d8941`, `85166b4`, `94c5543`）
- **階段目標**：實作 Supabase Email/Password 登入、註冊、登出與 `/dashboard`、`/login` 雙向路由保護。
- **如何向 AI 描述需求**：
  - 指定採用 `@supabase/ssr` 與 Next.js 16 App Router Server Actions，要求拆分瀏覽器／伺服器端 Supabase Client，並要求於路由層與 Server Component 層皆透過 `getUser()` 驗證 Session，錯誤訊息轉為繁體中文。
- **AI 產出程式碼**：
  - `src/utils/supabase/client.ts`、`src/utils/supabase/server.ts`、`src/utils/supabase/middleware.ts`
  - `src/proxy.ts`
  - `src/app/login/page.tsx`、`src/app/login/actions.ts`、`src/app/auth/callback/route.ts`
  - `src/components/SignOutButton.tsx`、`src/app/dashboard/page.tsx`
- **如何驗證正確性**：
  - 啟動 `npm run dev` 進行完整手動 E2E 測試：未登入直連 `/dashboard` 確認重導至 `/login` → 測試註冊與登入流程 → 已登入直連 `/login` 確認導回 `/dashboard` → 點擊登出驗證 Session 清除。
- **修正 AI 的錯誤或幻覺**：
  - **Next.js 16 規範幻覺（`middleware.ts` 棄用）**：AI 依舊版習慣產生 `src/middleware.ts`，但專案使用 Next.js `16.4.6` 已將入口規範改為 `src/proxy.ts`（匯出 `proxy` 函式）；實測發現警告後立即重構為 `src/proxy.ts`。
  - **預渲染 `Blocking Route` 錯誤**：AI 產出的 `/dashboard` 在執行期觸發 `Next.js encountered the unstable value Date.now() while prerendering`（主因為 `@supabase/ssr` 底層 `GoTrueClient` 在宣告動態請求前呼叫 `Date.now()`）。經查錯後於 `src/app/dashboard/page.tsx` 導入 `next/server` 的 `await connection()` 並以 `<Suspense>` 包覆非同步內容成功解決。

---

### Phase 3：Threads Playwright 爬蟲與高擬真 Mock Fallback 模組
- **對應分支與 Commit**：`feat/threads-crawler`（`d460da9`, `4d2b55a`）
- **階段目標**：實作可穩定運作的 Threads 公開貼文爬蟲，並確保遭遇登入牆或反爬蟲時 100% 無縫降級至高擬真本地資料集。
- **如何向 AI 描述需求**：
  - 提供 `public.posts` 與 `analysis_tasks` 的欄位定義，要求 AI 先產出 30 篇繁體中文、具備高／中／低三群組差異且排除 `total_engagement` Generated Column 的 Mock Dataset；再設計具隨機延遲、資源攔截、超時控管與結構化錯誤降級的 Playwright 爬蟲模組。
- **AI 產出程式碼**：
  - `data/mock_threads_posts.json`（30 篇高／中／低互動貼文樣本，含 `view_count: null` 與多樣文字特徵）
  - `src/lib/crawler/types.ts`、`src/lib/crawler/utils.ts`、`src/lib/crawler/threadsScraper.ts`、`src/lib/crawler/index.ts`
- **如何驗證正確性**：
  - 撰寫本地測試腳本，分別針對 `ENABLE_MOCK_FALLBACK="true"`（直接回傳 Mock）與 `ENABLE_MOCK_FALLBACK="false"`（實際以 Playwright 測試 `@taipei_pm_notes` 與 `@zuck`）執行驗證，確認遭遇登入牆時能正確觸發降級並回傳對應 `fallback_reason`。
- **修正 AI 的錯誤或幻覺**：
  - **安裝指令錯誤**：修正 `npx exec playwright install chromium` 為正確指令 `npx playwright install chromium`。
  - **`instanceof` 跨模組判斷失效**：測試真實爬取降級時觸發 `TypeError: Right-hand side of 'instanceof' is not an object`；將 `index.ts` 中的錯誤攔截改為結構化型別守衛 `isCrawlerErrorLike()`，確保任何異常皆能安全降級。
  - **PowerShell 語法踩雷**：Windows PowerShell 傳入 `@zuck` 時會誤判為 Splatting 展開，改以雙引號包覆（`"@zuck"`）解決；並補回手動編輯 `catch` 時遺漏的大括號編譯錯誤。

---

### Phase 4：資料清理、三群組 NLP 分析與後端 API 整合
- **對應分支與 Commit**：`feat/nlp-analysis`（`9ff56df`）
- **階段目標**：完成貼文去重、時區與文字特徵提取、三群組抽樣、Gemini Structured Outputs 語意分析與 `POST /api/analyze` 全流程串接。
- **如何向 AI 描述需求**：
  - 要求將清理與分析拆為純函式模組 `dataCleaner.ts` 與 `nlpAnalyzer.ts`，並明確指定 `Asia/Taipei` 時段統計、每組抽樣 3–5 篇貼文、`@google/genai` SDK 的嚴格 JSON Schema 輸出，以及 24 小時帳號快取檢查。
- **AI 產出程式碼**：
  - `src/lib/analyzer/dataCleaner.ts`
  - `src/lib/analyzer/nlpAnalyzer.ts`
  - `src/app/api/analyze/route.ts`
  - 實際測試產出之本地報告驗證樣本：`reports/taipei_pm_notes_*.json/.md`、`reports/zuck_*.json/.md`、`reports/ai_builder_tw_*.json/.md`
- **如何驗證正確性**：
  - 執行 `npx tsc --noEmit` 確保零型別錯誤；透過瀏覽器 Console 帶入登入 Cookie 呼叫 `POST /api/analyze`，檢查 HTTP `200` 回傳結構、Supabase 五張表寫入紀錄、快取二次命中行為以及 `reports/` 產出檔內容。
- **修正 AI 的錯誤或幻覺**：
  - **匯入路徑幻覺**：AI 初版預設引入 `@/lib/supabase/server`，但專案實際路徑為 `@/utils/supabase/server`；另修正動態載入爬蟲模組導致 `500` 的錯誤，改為靜態具名匯入 `crawlThreadsPosts`。
  - **Gemini 模型版本過時（`404 NOT_FOUND`）**：AI 原先寫死呼叫 `gemini-2.5-flash`，實測遭 Google API 回傳 `404`。升級為 **`gemini-3.8-flash`**（搭配 `LLM_MODEL` 環境變數）並移除 Gemini 3.x 不建議傳入的 `temperature` 參數。
  - **尖峰 `503 UNAVAILABLE` 與逾時重構**：實測單一模型重試 3 次耗時 68 秒超過 Vercel 上限，遂要求重構為 **多模型自動降級鏈（`gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`）＋單次 18 秒 `withTimeout`＋統計規則兜底（`buildRuleBasedFallbackAnalysis`）**，並修復重構過程中 AI 遺漏宣告 `insightByPostId` Map 與 Markdown 樣板反引號未跳脫的語法錯誤。

---

### Phase 5：前端數據儀表板、視覺化圖表與報表匯出
- **對應分支與 Commit**：`feat/dashboard`（`a8bffae`）
- **階段目標**：建置完整互動式儀表板 UI、歷史報告 API、Recharts 圖表與前端 CSV/JSON 匯出功能。
- **如何向 AI 描述需求**：
  - 提供 `/api/analyze` 與資料庫回傳的完整 TypeScript 型別結構，要求 AI 以模組化元件拆分 KPI 卡片、圖表、Top Posts 表格、AI 洞察面板與分析表單，並補齊 `GET /api/reports` 讓使用者重新整理頁面後仍可檢視歷史分析紀錄。
- **AI 產出程式碼**：
  - `src/app/api/reports/route.ts`
  - `src/types/dashboard.ts`、`src/lib/normalize-report.ts`、`src/lib/export-report.ts`
  - `src/components/dashboard/DashboardClient.tsx`、`AnalyzeForm.tsx`、`KpiCards.tsx`、`DashboardCharts.tsx`、`TopPostsTable.tsx`、`AiInsightsSection.tsx`
- **如何驗證正確性**：
  - 透過瀏覽器實測輸入帳號送出分析、切換歷史報告、檢視圖表 Tooltip 與 RWD 版面、點擊匯出按鈕檢查下載的 CSV（中文編碼無亂碼）與 JSON 結構是否完整。
- **修正 AI 的錯誤或幻覺**：
  - **TypeScript 與執行期屬性錯誤**：修正 `DashboardCharts.tsx` 中 Recharts `Tooltip` / `formatter` 的型別不相容問題、`AnalyzeForm.tsx` 狀態型別錯誤，以及 `DashboardClient.tsx` 讀取深層巢狀欄位未防呆導致的 Runtime TypeError（統一收斂至 `src/lib/normalize-report.ts` 做容錯標準化）。
  - **SSR Hydration Mismatch**：修正伺服器端與瀏覽器端日期／數字語系格式化差異導致的 React Hydration 警告。

---

### Phase 6：多帳號並排比較、Mock 差異化與登入體驗強化
- **對應分支與 Commit**：`feat/dashboard`（`a8bffae`）
- **階段目標**：完成多帳號數據比較功能，並針對評審體驗優化 Mock 差異化數據與登入／註冊防呆。
- **如何向 AI 描述需求**：
  - 要求實作 `AccountComparison.tsx`，允許勾選 2 個以上已分析帳號並排比較 KPI 與圖表；同時指出「若所有帳號降級都回傳一模一樣的 Mock 數字，多帳號比較圖表會完全重疊」，要求依帳號名稱套用穩定的倍率差異。
  - 要求於 `/login` 新增「評審測試帳號一鍵填入」按鈕（`demo@gmail.com` / `DemoPassword123!`），並於註冊流程阻擋 `@example.com` 等假網域。
- **AI 產出程式碼**：
  - `src/components/dashboard/AccountComparison.tsx`
  - 更新 `src/lib/crawler/index.ts`（Mock 帳號倍率差異化）與 `src/app/login/page.tsx`、`src/app/login/actions.ts`
- **如何驗證正確性**：
  - 連續分析 3 個帳號（`taipei_pm_notes`、`zuck`、`ai_builder_tw`），於多帳號比較區勾選對比，確認數值與柱狀圖有明顯差異且可重複再現；測試註冊 `@example.com` 確認被前端／後端正確攔截，並實測測試帳號一鍵登入功能。
- **修正 AI 的錯誤或幻覺**：
  - 排查測試期間出現的 Supabase Schema 資料表查詢遺失錯誤，確認資料庫 Migration 狀態與環境變數指向同一 Supabase 專案，確保多帳號歷史紀錄能正確持久保存與讀取。

---

### Phase 7：單元測試、Docker 多階段建置與 Vercel 部署設定
- **對應分支與 Commit**：`feat/docs-deployment`（`5001760`）
- **階段目標**：補齊核心邏輯自動化單元測試，並交付可一鍵啟動的 `Dockerfile` 與 Vercel 超時設定檔 `vercel.json`。
- **如何向 AI 描述需求**：
  - 貼上專案實際的 `package.json`，請 AI 產出適用於 Next.js 16 + Playwright 的多階段 `Dockerfile`、`vercel.json`（將 `/api/analyze` 之 `maxDuration` 設為 `60`），以及針對資料清理與三群組分類的 Vitest 單元測試腳本。
- **AI 產出程式碼**：
  - `Dockerfile`（3-Stage Multi-stage build，安裝 Chromium 系統相依套件）
  - `vercel.json`
  - `src/__tests__/analyzer.test.ts`（2 個核心邏輯單元測試）並更新 `package.json` 的 `test` / `test:watch` 指令
- **如何驗證正確性**：
  - 執行 `npm test`（Vitest 5.1.1），2 項測試於 264ms 內全數通過（`1 passed / 2 passed`）。
  - 執行 `npm run build` 通過 Next.js Turbopack 編譯與 TypeScript 型別檢查。
  - 本機實際執行 `docker build` 與 `docker run` 驗證容器可正常打包與啟動。
- **修正 AI 的錯誤或幻覺**：
  - **Vitest 5 與 `@types/node` 版本衝突**：執行 `npm install -D vitest` 時因專案原鎖定 `@types/node@^20` 而觸發 `ERESOLVE` 衝突；依建議升級為 `npm install -D vitest @types/node@^22` 乾淨解決，避免使用 `--legacy-peer-deps` 影響 CI/Docker。
  - **Docker Build 階段預渲染 `/login` 報錯**：因 `.dockerignore` 排除 `.env*`，`RUN npm run build` 預渲染 `/login` 時找不到 Supabase 公開金鑰；透過 `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=...` 成功通過。
  - **Node.js 20 棄用警告與環境變數檔名排查**：`@supabase/supabase-js` 提示 Node 20 將於未來版本棄用，隨即將 `Dockerfile` 基底映像由 `node:20-bookworm-slim` 升級至 `node:22-bookworm-slim`；並排查本機 `.env` 與 `.env.local` 檔名差異，順利完成容器啟動。

---

### Phase 8：文件同步校對與最終交付驗收
- **對應分支**：`feat/docs-deployment` → 合併至 `main`
- **階段目標**：全面對照實際程式碼、Git 紀錄、`.env.example` 與 `package.json`，同步更新最終版 `PRD.md`、`AI_LOG.md` 與 `README.md`，確保文件與程式碼 100% 一致。
- **驗證方式**：逐條檢查考題交付規範（README 五大必備章節、AI_LOG 五項必要紀錄、測試帳號一致性、模型名稱 `gemini-3.8-flash` 與環境變數對齊），確認零矛盾後完成最終交付。

---

## 二、 AI 協作規範五項核心總結

### 1. 我如何向 AI 描述需求
- **PRD 先行與上下文鎖定**：先與 AI 確立 `PRD.md` 與資料庫 Schema，後續每個分支開發皆附上現有 `package.json`、資料表結構或相關檔案路徑，避免 AI 憑空猜測介面。
- **單一分支、單一職責拆分**：依照 `init-supabase` → `auth` → `threads-crawler` → `nlp-analysis` → `dashboard` → `docs-deployment` 切分任務，每次只聚焦一個模組並明訂輸入／輸出型別與驗收標準。
- **具體貼上錯誤日誌**：遇到報錯時不靠口頭轉述，而是直接貼上完整終端機堆疊訊息（如 `ERESOLVE`、Next.js prerender digest、`503 UNAVAILABLE`），大幅提升定位準確度。

### 2. AI 幫我產生了哪些程式碼
- **資料庫與認證**：`supabase/migrations/20261120000000_init_schema.sql`、`src/proxy.ts`、`src/utils/supabase/*`、`src/app/login/*`、`src/app/auth/callback/route.ts`。
- **爬蟲與 Mock 資料**：`data/mock_threads_posts.json`、`src/lib/crawler/*`（Playwright 爬取、文字解析與自動降級封裝）。
- **分析引擎與後端 API**：`src/lib/analyzer/dataCleaner.ts`、`src/lib/analyzer/nlpAnalyzer.ts`（Gemini 3.8 Flash Structured Outputs 與降級鏈）、`src/app/api/analyze/route.ts`、`src/app/api/reports/route.ts`。
- **前端儀表板與匯出**：`src/components/dashboard/*`（7 個儀表板元件）、`src/types/dashboard.ts`、`src/lib/normalize-report.ts`、`src/lib/export-report.ts`。
- **測試與部署**：`src/__tests__/analyzer.test.ts`、`Dockerfile`、`vercel.json`。

### 3. 我如何驗證 AI 產出的正確性
- **靜態型別與建置驗證**：每完成一個功能模組皆執行 `npx tsc --noEmit` 與 `npm run build`，確保無型別錯誤與 SSR 預渲染問題。
- **自動化單元測試**：透過 Vitest 執行 `npm test`，驗證資料去重、負值防呆、Nullable 瀏覽數保留與三群組分類演算法邏輯。
- **資料庫與 API 端對端驗證**：在 Supabase SQL Editor 實際跑通 Migration，並以真實登入 Session 呼叫 `/api/analyze` 與 `/api/reports`，檢查五張表資料寫入、RLS 隔離、快取命中與降級紀錄。
- **容器與使用者流程實測**：本機執行 `docker build` / `docker run`，並以瀏覽器完整走訪「未登入攔截 → 測試帳號登入 → 單帳號分析 → 多帳號比較 → 匯出 CSV/JSON → 登出」流程。

### 4. 我修正了哪些 AI 的錯誤或幻覺
1. **框架版本幻覺**：修正 Next.js 16 沿用舊版 `middleware.ts` 的問題，改為 `src/proxy.ts`；並為 `/dashboard` 補上 `await connection()` 與 `<Suspense>` 解決 `Date.now()` 預渲染失敗。
2. **過時 LLM 模型幻覺**：AI 初版預設呼叫已無法供新帳號使用的 `gemini-2.5-flash` 導致 `404`，實測後升級為 `gemini-3.8-flash` 並補建多模型降級鏈與規則引擎兜底。
3. **路徑與語法失誤**：修正 AI 誤寫的 `@/lib/supabase/server` 路徑、重構時遺漏的 `insightByPostId` 變數、樣板字串未跳脫反引號，以及跨模組 `instanceof` 檢查失敗問題。
4. **安全性與依賴補強**：在 RLS 寫入政策補齊父層外鍵 `EXISTS` 歸屬驗證；升級 `@types/node` 至 v22 與 Docker 基底映像至 `node:22-bookworm-slim` 以排除 Vitest 5 相依衝突與 Supabase Node 20 棄用警告。

### 5. 哪些部分我認為 AI 幫助最大
- **高複雜度樣板與架構起手式**：在 Supabase 5 表正規化 Schema、RLS 政策與 `@supabase/ssr` 前後端整合上，AI 快速產出高完整度骨架，節省大量查閱文件時間。
- **結構化 Prompt 與資料處理邏輯**：快速建立 Gemini Structured Outputs 的嚴格 `responseSchema`、繁體中文高擬真 Mock Dataset 以及 Recharts 多維度圖表元件。
- **錯誤日誌判讀與容錯重構**：面對 Next.js 16 預渲染錯誤、Playwright 登入牆降級與 Gemini 503 逾時保護時，AI 能迅速協助設計具備生產級韌性的降級鏈與除錯步驟。