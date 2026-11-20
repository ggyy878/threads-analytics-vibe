// src/lib/crawler/index.ts
import mockDatasetRaw from "../../../data/mock_threads_posts.json";
import { scrapeThreadsAccount } from "./threadsScraper";
import {
  CrawlOptions,
  CrawlResult,
  MockDatasetSchema,
  ScrapedAccountProfile,
  ScrapedPostRecord,
  ThreadsCrawlerError,
} from "./types";
import { normalizeThreadsTarget, toSupabasePostInsertRows } from "./utils";

const mockDataset = mockDatasetRaw as MockDatasetSchema;

function isCrawlerErrorLike(
  err: unknown
): err is { code: string; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  );
}

/**
 * 載入本地高擬真 Fallback Mock Dataset
 * 並確保回傳資料獨立深拷貝、不汙染模組記憶體快取
 */
function buildMockFallbackResult(
  inputQuery: string,
  fallbackReason: string,
  targetPostCount: number,
  startedAt: number
): CrawlResult {
  let requestedUsername = mockDataset.account.username;
  let requestedProfileUrl = mockDataset.account.profile_url;

  try {
    const normalized = normalizeThreadsTarget(inputQuery);
    requestedUsername = normalized.username;
    requestedProfileUrl = normalized.profileUrl;
  } catch {
    // 若連輸入格式都無法解析，保留預設 Mock 帳號以確保絕不崩潰
  }

  const account: ScrapedAccountProfile = {
    ...mockDataset.account,
    username: requestedUsername,
    profile_url: requestedProfileUrl,
    display_name:
      requestedUsername === mockDataset.account.username
        ? mockDataset.account.display_name
        : `${requestedUsername}（Fallback 示範資料）`,
  };

  const posts: ScrapedPostRecord[] = mockDataset.posts
    .slice(0, Math.max(1, targetPostCount))
    .map((post) => ({
      ...post,
      post_url: post.post_url.replace(
        `/@${mockDataset.account.username}/`,
        `/@${requestedUsername}/`
      ),
      hashtags: [...post.hashtags],
      mentions: [...post.mentions],
      raw_payload: {
        ...(post.raw_payload ?? {}),
        fallback_applied: true,
        original_mock_account: mockDataset.account.username,
      },
    }));

  return {
    account,
    posts,
    data_source: "mock_fallback",
    is_fallback_used: true,
    fallback_reason: fallbackReason,
    fetched_post_count: posts.length,
    duration_ms: Date.now() - startedAt,
  };
}

/**
 * Phase 3 爬蟲統一對外入口（內建自動降級保護機制）
 * 1. ENABLE_MOCK_FALLBACK === "true" 時直接回傳高擬真 Mock 資料
 * 2. 否則執行 Playwright 爬取；若遇登入牆、反爬蟲、超時或任何異常，自動降級回傳 Mock 資料
 */
export async function crawlThreadsPosts(
  inputQuery: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const startedAt = Date.now();
  const targetPostCount = Math.max(1, options.targetPostCount ?? 30);

  const envFallbackEnabled =
    (process.env.ENABLE_MOCK_FALLBACK ?? "").trim().toLowerCase() === "true";

  if (options.forceMockFallback || envFallbackEnabled) {
    const reason = options.forceMockFallback
      ? "FORCE_MOCK_FALLBACK_OPTION"
      : "ENV_ENABLE_MOCK_FALLBACK_TRUE";

    return buildMockFallbackResult(
      inputQuery,
      reason,
      targetPostCount,
      startedAt
    );
  }

  try {
    const scraped = await scrapeThreadsAccount(inputQuery, {
      ...options,
      targetPostCount,
    });

    return {
      account: scraped.account,
      posts: scraped.posts,
      data_source: "playwright",
      is_fallback_used: false,
      fallback_reason: null,
      fetched_post_count: scraped.posts.length,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    const fallbackReason = isCrawlerErrorLike(error)
      ? `${error.code}: ${error.message}`
      : `UNEXPECTED_ERROR: ${error instanceof Error ? error.message : String(error)}`;

    console.warn("[ThreadsCrawler] 爬取失敗，自動切換至 Mock Fallback 資料集：", {
      inputQuery,
      fallbackReason,
    });

    return buildMockFallbackResult(
      inputQuery,
      fallbackReason,
      targetPostCount,
      startedAt
    );
  }
}

export {
  scrapeThreadsAccount,
  normalizeThreadsTarget,
  toSupabasePostInsertRows,
  ThreadsCrawlerError,
};
export type {
  CrawlOptions,
  CrawlResult,
  DataSourceType,
  EngagementTier,
  PostInsertRow,
  ScrapedAccountProfile,
  ScrapedPostRecord,
} from "./types";