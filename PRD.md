# 產品需求規格書 (PRD)：Threads 帳號貼文爬取與數據分析工具

## 1. 產品目標與問題定義
- **產品目標**：協助內容團隊與社群行銷人員快速輸入 Threads 帳號名稱或 URL，自動蒐集近期貼文（至少 30 篇），進行資料清理、NLP 內文分群成敗分析，並產出互動表現圖表與 AI 策略建議。
- **目標使用者**：社群運營團隊、行銷企劃人員。
- **本次不處理範圍**：即時串流監控、自動化排程發文、跨社群平台（如 Instagram/Facebook）原生整合。

## 2. 功能描述與需求釐清
- **資料取得 (Task 1)**：
  - 輸入 Threads 帳號 URL 或 Username（使用 Playwright 進行爬取）[cite: 1]。
  - 取得最近至少 30 篇貼文，包含發文時間、文字內容、Like 數、Reply 數、Repost/Quote 數、貼文 URL[cite: 1]。
  - **Fallback 機制**：若 Playwright 爬取受阻（如 Meta 反爬蟲或登入牆），系統自動切換至高擬真 Mock Dataset。
  - **欄位調整**：因公開網頁無法穩定取得曝光數，**曝光數欄位設為可選 (Nullable)**，並以「總互動數（Like + Reply + Repost + Quote）」作為核心排序指標。
- **資料清理與 NLP 分群分析 (Task 2 & 3)**：
  - 移除重複貼文、處理缺失欄位、統一時區、處理文字特徵（字數、hashtag、mention、URL 數量）[cite: 1]。
  - **分群與 NLP 分析**：根據按讚及回覆指標分成三個群組（總互動量高/中/低三分位或比例結構），並針對每組 3–5 篇貼文透過 **LLM 結構化 Prompt** 分析內文，歸納成功與失敗原因[cite: 1]。
- **前端儀表板與多帳號比較 (Task 4 & 6)**：
  - 呈現總覽指標、Top posts 表格、至少 2 張圖表 (Recharts)、內容策略觀察與 LLM 建議[cite: 1]。
  - **多帳號比較**：支援使用者同時勾選已分析過的 2 個以上不同帳號進行數據並排對比。
- **使用者認證與權限 (Task 6)**：
  - 支援 Supabase Auth (Email / Password 或 Magic Link)，未登入不可查看 Dashboard[cite: 1]。
  - **測試便利性**：提供 Seed Data 與預置測試帳號，方便評審快速登入體驗。

## 3. 使用者流程 (User Flow)
1. 進入系統 $
ightarrow$ 2. 登入（支援測試帳號） $
ightarrow$ 3. 輸入 Threads 帳號發起分析任務（具備快取檢查避免重複爬取） $
ightarrow$ 4. 檢視資料儀表板、圖表、NLP 成敗分析與 AI 策略建議 $
ightarrow$ 5. 進行多帳號比較或匯出 CSV / JSON。

## 4. 資料與權限 (Supabase Schema & RLS)
- **資料表設計**：
  - `users`：使用者基本資料
  - `analysis_tasks`：分析任務紀錄（帳號、狀態、建立時間）
  - `posts`：貼文細節與 NLP 分群結果
  - `aggregated_reports`：彙總分析與 LLM 建議
- **權限控制 (RLS)**：啟用 Row Level Security，確保不同使用者僅能讀取與修改自己的任務與貼文資料[cite: 1]。

## 5. 例外情境與 Fallback 行為
- **爬蟲受阻/帳號不存在**：攔截 Playwright 異常，自動切換至 Mock Dataset 並於 UI 提示。
- **API 逾時 / 欄位缺失**：加入 Retry 機制與前端 Error Boundary，確保系統穩定不崩潰。

## 6. 驗收標準 (Given / When / Then)
- **Given** 使用者已登入系統，**When** 輸入有效 Threads 帳號並送出分析，**Then** 系統於指定時間內完成資料抓取與清理，並呈現 30 篇以上貼文的互動儀表板與圖表。

## 7. 非功能需求 (NFR)
- **安全性**：敏感金鑰透過環境變數保護，啟用 Supabase RLS 資料隔離。
- **效能**：導入快取機制，避免對相同帳號重複爬取。
- **可用性**：支援一鍵部署至 Vercel 及 Docker 本地容器化執行。

## 8. 開發拆解與優先級（對應 35 個單位時間評估）
- **Must (P0)**：Supabase Schema/RLS、Auth 模組、Mock/Playwright 資料獲取、基礎 Dashboard 呈現。
- **Should (P1)**：NLP 三群組分析、Recharts 圖表、多帳號比較。
- **Could (P2)**：CSV/JSON 匯出、Docker 容器化、完整 README 與 AI_LOG。