# Threads 帳號貼文爬取與數據分析工具 (`threads-analytics-vibe`)

本專案是一套基於 **Next.js 16**、**Supabase**、**Playwright** 與 **Gemini 3.8 Flash** 打造的 Threads 帳號貼文爬取與數據分析儀表板。使用者輸入任一公開 Threads 帳號或 URL 後，系統可自動取得近期至少 30 篇貼文，完成資料清理、互動三群組（高／中／低）分類、LLM 語意成敗歸因分析，並提供互動式圖表、多帳號並排比較與 CSV / JSON 報表匯出功能。

### 核心技術棧
- **前端與全端框架**：Next.js `16.4.6`（App Router / Turbopack）、React `19.3.0`、TypeScript `^5`、Tailwind CSS `4.3.3`
- **資料庫與身分驗證**：Supabase（PostgreSQL、Row Level Security、`@supabase/ssr` `^0.12.7`、`@supabase/supabase-js` `^2.119.2`）
- **資料抓取與備援**：Playwright `^1.65.1`（無頭 Chromium）＋ 本地高擬真 Mock Dataset 自動降級
- **NLP 語意分析**：Google GenAI SDK（`@google/genai` `^3.6.1`）、預設模型 `gemini-3.8-flash`（含多模型與規則引擎降級鏈）
- **視覺化與測試部署**：Recharts `^3.11.0`、Lucide React、Vitest `^5.1.1`、Docker（多階段建置）、Vercel

---

## 一、 如何安裝 (Installation)

### 1. 環境需求
- **Node.js**：`>= 22.0.0`（建議使用 Node.js 22 LTS，以相容 Vitest 5 與最新版 `@supabase/supabase-js`）
- **套件管理工具**：`npm`（隨 Node.js 附帶）
- **外部服務**：
  - 一個 [Supabase](https://supabase.com/) 專案（提供 PostgreSQL 資料庫與 Email 認證）
  - 一組 [Google AI Studio](https://aistudio.google.com/) Gemini API Key
- **選用工具**：Docker Desktop（若需透過容器一鍵啟動）

### 2. 複製專案並安裝依賴套件
```bash
git clone <repository-url>
cd threads-analytics-vibe
npm install
```

若需於本機啟用 Playwright 真實瀏覽器爬取功能，請安裝 Chromium 瀏覽器核心：
```bash
npx playwright install chromium
```

### 3. Supabase 資料庫建表（`supabase/migrations/`）
本專案之完整資料庫結構、索引、Generated Column、Auth 同步 Trigger 與 RLS 安全政策皆定義於 `supabase/migrations/20261120000000_init_schema.sql`，可擇一方式匯入：

- **方式 A：透過 Supabase Dashboard（推薦，最快速）**
  1. 登入 Supabase Dashboard，進入專案左側的 **SQL Editor**。
  2. 複製專案內 `supabase/migrations/20261120000000_init_schema.sql` 的全部內容。
  3. 貼上並點擊 **Run** 執行，即自動建立 `users`、`threads_accounts`、`analysis_tasks`、`posts`、`aggregated_reports` 五張資料表與 RLS 權限規則。
- **方式 B：透過 Supabase CLI**
  ```bash
  supabase link --project-ref <your-project-ref>
  supabase db push
  ```

### 4. 環境變數設定教學（`.env.example`）
將專案根目錄的 `.env.example` 複製為 `.env.local`：
```bash
cp .env.example .env.local
```

依照下表填入對應金鑰與設定值：

| 環境變數名稱 | 必填 | 預設值／範例 | 說明 |
| :--- | :---: | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | `https://xxx.supabase.co` | Supabase 專案 URL（於 Project Settings → API 取得） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 是 | `eyJ...` | Supabase 公開金鑰（`anon public`），供前後端已登入流程使用 |
| `SUPABASE_SERVICE_ROLE_KEY` | 是 | `eyJ...` | Supabase 服務金鑰（`service_role secret`），**僅限後端使用，嚴禁暴露於前端** |
| `GEMINI_API_KEY` | 是 | `AIza...` | Google AI Studio 核發之 Gemini API Key（主要供 `@google/genai` 呼叫） |
| `LLM_API_KEY` | 選填 | `AIza...` | 通用 LLM API Key 備用變數（可填入與 `GEMINI_API_KEY` 相同之金鑰） |
| `LLM_MODEL` | 否 | `gemini-3.8-flash` | 進行 NLP 結構化分析的主模型名稱 |
| `ENABLE_MOCK_FALLBACK` | 否 | `"false"` | 設為 `"true"` 時略過 Playwright，強制回傳本地 Mock Dataset（Vercel Serverless 建議設為 `"true"`）；設為 `"false"` 時優先執行真實爬取，遇阻擋自動降級 |
| `PLAYWRIGHT_TIMEOUT_MS` | 否 | `"30000"` | Playwright 單次爬取總超時上限（毫秒） |
| `SCRAPER_CACHE_TTL_HOURS` | 否 | `"24"` | 選填調整項：單一使用者針對同一 Threads 帳號之快取有效時數（預設 24 小時） |

---

## 二、 如何執行 (Execution)

### 1. 評審專用預設測試帳號
為了讓評審無需繁瑣的信箱驗證即可立即體驗完整功能（含已建立的儀表板操作權限），請直接於 `/login` 頁面點擊**「一鍵填入測試帳號」**按鈕，或手動輸入以下憑證登入：

- **測試信箱**：`demo@gmail.com`
- **測試密碼**：`DemoPassword123!`

*(若於 Supabase 後台自行部署全新資料庫，請先在 Supabase Authentication → Users 建立此測試帳號，或於前端註冊介面使用有效網域 Email 註冊。)*

### 2. 本地開發與正式建置啟動
```bash
# 開發模式啟動
npm run dev

# 正式環境編譯與啟動（部署前建議先驗證）
npm run build
npm run start
```
啟動後開啟瀏覽器前往 `http://localhost:3000` 即可使用（未登入將自動導向 `/login`）。

### 3. Docker 一鍵建置與啟動
專案根目錄已附帶適用於 Next.js 16 + Playwright（Chromium）的多階段 `Dockerfile`。因 Next.js 建置階段預渲染 `/login` 頁面需讀取 Supabase 公開環境變數，請透過 `--build-arg` 傳入後建置並啟動：

```bash
# 1. 建置映像檔（請替換為你的 Supabase URL 與 Anon Key）
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="[https://你的專案.supabase.co](https://你的專案.supabase.co)" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="你的_anon_key" \
  -t threads-analytics-vibe .

# 2. 載入環境變數檔並啟動容器
docker run -p 3000:3000 --env-file .env.local threads-analytics-vibe
```
*(若你的環境變數檔名為 `.env`，請將指令中的 `.env.local` 改為 `.env`。)*

### 4. 執行單元測試（Vitest）
本專案於 `src/__tests__/analyzer.test.ts` 提供針對「資料清理」與「三群組分類邏輯」的自動化單元測試：

```bash
# 單次執行全部單元測試
npm test

# 監看模式（開發除錯用）
npm run test:watch
```

### 5. Vercel 雲端部署說明
專案根目錄已配置 `vercel.json`，針對 `src/app/api/analyze/route.ts` 設定 `maxDuration: 60` 以避免爬蟲與 Gemini NLP 分析逾時。匯入 GitHub 儲存庫至 Vercel 後，於 **Project Settings → Environment Variables** 補齊 `.env.example` 之環境變數（建議於 Vercel 環境將 `ENABLE_MOCK_FALLBACK` 設為 `"true"` 以確保 Serverless 執行穩定度）即可完成部署。

---

## 三、 資料來源是否合法取得 (Data Source Legality)

1. **僅解析公開頁面結構，絕不觸及隱私**：本系統的 Playwright 模組僅針對使用者主動輸入之 **公開（Public）Threads 帳號貼文** 進行前端公開 DOM 結構解析，絕不模擬登入私人帳號、不破解存取權限，亦不蒐集任何非公開之個人隱私資料。
2. **遵守合理請求頻率與快取保護**：
   - 爬蟲內建隨機滾動間隔、請求延遲（Throttling）與 `PLAYWRIGHT_TIMEOUT_MS` 超時上限，避免對目標網站造成過度負載。
   - 系統於資料庫層級實作帳號快取機制（預設 24 小時 TTL），相同帳號於快取效期內重複查詢將直接讀取快取結果，大幅降低重複請求頻率。
3. **高擬真 Mock Dataset 展示與自動降級備援**：為完全尊重平台防禦機制與使用條款，本專案內建 30 篇繁體中文高擬真模擬資料集（`data/mock_threads_posts.json`）作為主要展示資料與自動降級備援。一旦偵測到登入牆（`LOGIN_WALL`）或反爬蟲阻擋（`ANTI_BOT_BLOCKED`），系統立即停止爬取並無縫切換至 Mock Dataset，絕不採用任何繞過驗證碼或違反平台使用條款之手段。

---

## 四、 分析指標定義 (Metrics Definition)

### 1. 核心互動排序指標
由於 Threads 公開網頁無法穩定提供貼文曝光數（`view_count` 設為 Nullable），本系統於 PostgreSQL 透過 Generated Column 自動彙算 **總互動數（`total_engagement`）** 作為核心排序與分群依據：

$$\text{total\_engagement} = \text{like\_count} + \text{reply\_count} + \text{repost\_count} + \text{quote\_count}$$

- **平均每篇互動**：收錄貼文之 `total_engagement` 總和除以分析貼文篇數（預設至少 30 篇）。
- **互動中位數（Median Engagement）**：避免單一爆文極端值扭曲整體表現評估。
- **回覆佔比（`reply_ratio`）**：$\text{reply\_count} \div \text{total\_engagement}$，衡量貼文引發受眾留言討論的深度。
- **互動率（Engagement Rate）**：若該貼文具有效 `view_count` 則以 `total_engagement / view_count` 計算；若 `view_count` 為 `null` 且具追蹤者數，則自動改以 `follower_count` 作為分母估算。

### 2. 文字與發文特徵提取規則（`src/lib/analyzer/dataCleaner.ts`）
系統針對每篇去重後的貼文自動抽取以下量化特徵，供圖表視覺化與 NLP 對照分析：
- **字數長度（`char_count`）**：移除首尾空白後的內文字元總數。
- **互動語氣偵測（`has_question`）**：偵測內文是否包含中英文問號（`?` / `？`）或常見中文提問／號召互動詞彙。
- **社群元素標記**：擷取 `hashtags` 陣列、`mentions`（`@帳號`）陣列與外部連結數（`url_count`）。
- **媒體型態（`has_media` / `media_type`）**：區分純文字、單圖、輪播或影音等呈現形式。
- **時區與發文時段分布**：原始時間統一以 UTC（`TIMESTAMPTZ`）儲存，分析統計時統一轉換為台灣時間（`Asia/Taipei`），劃分 24 小時、四時段（凌晨／上午／下午／晚間）與星期一至星期日之平均互動表現。

### 3. 高／中／低三群組分類標準與 NLP 抽樣策略（`src/lib/analyzer/nlpAnalyzer.ts`）
- **三群組切分邏輯**：
  1. 將所有清理後的貼文依 `total_engagement` 由高至低排序（同分時依 `reply_count`、`like_count` 次排序）。
  2. 依總篇數等比例切分為三個群組：前 1/3 為 **高互動群組（`high`）**、中段 1/3 為 **中互動群組（`medium`）**、後 1/3 為 **低互動群組（`low`）**，並記錄對應門檻值 `high_tier_threshold` 與 `low_tier_threshold`。
- **NLP 抽樣與語意歸納策略**：
  - 為兼顧語意代表性與 LLM Token 成本，系統從高、中、低三個群組各抽樣 **3–5 篇代表性貼文（預設 4 篇）** 並標記 `is_nlp_sample = true`。
  - 將抽樣貼文內文與整體文字特徵統計送交 **`gemini-3.8-flash`**，透過嚴格 JSON `responseSchema`（Structured Outputs）產出繁體中文成敗分析報告，包含：高互動成功因素與 Hook 句型拆解（附佐證 `post_id`）、低表現成因歸納、跨群組數據觀察與 P0–P2 可執行內容策略建議。

---

## 五、 已知限制 (Known Limitations)

1. **Threads 前端 DOM 動態變動與登入牆反爬蟲機制**：
   - Meta／Threads 頻繁調整公開頁面的 DOM 結構，且未登入狀態下極易觸發登入牆（`LOGIN_WALL`）或反爬蟲挑戰（`ANTI_BOT_BLOCKED`）。
   - **應對方式**：系統於觸發阻擋、帳號不存在或超時未抓到貼文時，會自動降級回傳 `data/mock_threads_posts.json`（並依帳號名稱套用確定性倍率差異以利多帳號比較），同時於儀表板與資料庫透明標示 `is_fallback_used` 與 `fallback_reason`。
2. **免費版 LLM API 速率限制與尖峰壅塞**：
   - 免費額度之 Gemini API 具每分鐘請求次數（RPM）與 Token 速率限制，尖峰時段偶有 `429` 或 `503 UNAVAILABLE` 錯誤。
   - **應對方式**：系統內建多模型自動降級鏈（`gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`）與單次 18 秒超時保護；若所有模型皆暫時不可用，將自動由統計規則引擎兜底產出結構化分析結果，確保服務不中斷。
3. **公開網頁缺乏曝光數（`view_count`）**：
   - Threads 公開貼文頁面並未提供完整曝光數，故 `view_count` 維持 Nullable 設計，所有核心排序、分群與圖表皆以可驗證之實質互動數（`total_engagement`）為基準。
4. **Vercel Serverless 執行環境限制**：
   - Vercel Serverless Function 預設不含大型無頭瀏覽器二進位檔，且檔案系統為唯讀（Read-only）。因此部署於 Vercel 時建議將 `ENABLE_MOCK_FALLBACK` 設為 `"true"`，而本機分析時同步寫入 `reports/` 的功能於 Serverless 環境會自動靜默略過（不影響資料庫寫入與前端一鍵匯出 CSV / JSON）；此外 `/api/analyze` 已透過 `vercel.json` 延長超時上限至 `60` 秒。
5. **Per-User 快取隔離與信箱驗證限制**：
   - 基於 Supabase RLS 嚴格資料隔離原則，不同登入帳號對同一 Threads 帳號的快取彼此獨立，無法跨使用者共享。
   - 註冊介面會阻擋 `@example.com` 等無效測試網域；若 Supabase 後台開啟「Confirm email」，須於 Supabase Authentication → URL Configuration 的 Redirect URLs 加入應用程式的 `/auth/callback` 路徑。