# AI_LOG.md - Vibe Coding 開發日誌

文件記錄本專案在 AI 協作 (Vibe Coding) 過程中的提示詞互動、架構演進、驗證方式與幻覺修正紀錄。

---

## Checkpoint 0：專案初始化與規格定案
- **日期**：2026-11-20
- **協作工具**：Cursor IDE + Gemini Pro 學生 Pro 方案
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