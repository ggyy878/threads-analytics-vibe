// scripts/test-crawler.ts
import { crawlThreadsPosts, toSupabasePostInsertRows } from "../src/lib/crawler";

async function main() {
  const target = process.argv[2] ?? "@zuck";
  console.log(`=== 開始測試爬取：${target} ===`);
  console.log("ENABLE_MOCK_FALLBACK =", process.env.ENABLE_MOCK_FALLBACK ?? "(未設定)");
  console.log("PLAYWRIGHT_TIMEOUT_MS =", process.env.PLAYWRIGHT_TIMEOUT_MS ?? "(預設 30000)");

  const result = await crawlThreadsPosts(target, { targetPostCount: 30 });

  console.log("\n--- 執行結果摘要 ---");
  console.log("帳號：", result.account.username, "| 網址：", result.account.profile_url);
  console.log("資料來源 (data_source)：", result.data_source);
  console.log("是否觸發降級 (is_fallback_used)：", result.is_fallback_used);
  console.log("降級原因 (fallback_reason)：", result.fallback_reason);
  console.log("抓取篇數 (fetched_post_count)：", result.fetched_post_count);
  console.log("耗時 (ms)：", result.duration_ms);

  // 驗證轉換為 Supabase public.posts Insert 格式是否無誤
  const rows = toSupabasePostInsertRows(result.posts, {
    task_id: "00000000-0000-0000-0000-000000000001",
    account_id: "00000000-0000-0000-0000-000000000002",
    user_id: "00000000-0000-0000-0000-000000000003",
  });

  console.log("\n--- 第一篇貼文格式抽查 ---");
  console.log(JSON.stringify(rows[0], null, 2));
}

main().catch((err) => {
  console.error("測試過程發生未預期錯誤：", err);
  process.exit(1);
});