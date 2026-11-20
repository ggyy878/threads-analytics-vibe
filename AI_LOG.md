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