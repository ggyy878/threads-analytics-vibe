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
   必要環境變數說明：
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase 專案 URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase 公開金鑰
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase 服務金鑰 (後端爬蟲與資料寫入)
   - `LLM_API_KEY`: 進行 NLP 語意分析的 LLM API Key

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
   $$	ext{Total Interactions} = 	ext{Likes} + 	ext{Replies} + 	ext{Reposts} + 	ext{Quotes}$$
   （作為綜合互動表現排序的核心指標）。
2. **平均每篇互動 (Average Engagement per Post)**：
   總互動數除以收錄貼文總數（預設至少 30 篇）。
3. **貼文分類類型 (Content Mix)**：
   依據貼文特徵分為純文字、含連結、含 hashtag、含 mention 等類型。
4. **NLP 成敗原因分群分析 (NLP Grouping & Insights)**：
   根據按讚與回覆指標將貼文分為三大互動群組，並針對各組貼文萃取內文語意，透過 LLM 歸納出成功吸引互動或成效較低的核心原因。

---

## 五、 已知限制 (Known Limitations)

1. **動態 DOM 變動影響**：Threads 網頁前端結構若經常變動，Playwright 選擇器可能需進行對應維護。
2. **曝光數欄位限制**：因 Threads 公開網頁未提供準確的曝光數數據，曝光數欄位採可選 (Nullable) 設計，主要以實質互動數（Like/Reply/Repost）進行深度分析。
3. **速率限制 (Rate Limit)**：短時間內頻繁對單一帳號發起爬取可能觸發平台防護，系統已實作快取與 Retry 機制予以緩解。