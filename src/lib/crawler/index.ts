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
 * 依帳號名稱計算固定倍率（0.55 ~ 1.85），預設基準帳號維持 1.0
 */
function getAccountMultiplier(username: string, baseUsername: string): number {
  const normalized = username.trim().toLowerCase();
  if (normalized === baseUsername.trim().toLowerCase()) return 1.0;

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % 1000;
  }
  return Number((0.55 + (hash / 1000) * 1.3).toFixed(2));
}

/**
 * 為不同互動指標加入微幅比例差異（0.85 ~ 1.15），避免所有帳號完全等比例縮放
 */
function getMetricJitter(username: string, seed: number): number {
  const normalized = username.trim().toLowerCase();
  let hash = seed;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 17 + normalized.charCodeAt(i)) % 100;
  }
  return 0.85 + (hash / 100) * 0.3;
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

  const isBaseMockAccount =
    requestedUsername.toLowerCase() === mockDataset.account.username.toLowerCase();
  const baseMultiplier = getAccountMultiplier(
    requestedUsername,
    mockDataset.account.username
  );

  const likeFactor = isBaseMockAccount
    ? 1
    : baseMultiplier * getMetricJitter(requestedUsername, 1);
  const replyFactor = isBaseMockAccount
    ? 1
    : baseMultiplier * getMetricJitter(requestedUsername, 2);
  const repostFactor = isBaseMockAccount
    ? 1
    : baseMultiplier * getMetricJitter(requestedUsername, 3);
  const quoteFactor = isBaseMockAccount
    ? 1
    : baseMultiplier * getMetricJitter(requestedUsername, 4);

  const scaledFollowerCount =
    mockDataset.account.follower_count !== null
      ? isBaseMockAccount
        ? mockDataset.account.follower_count
        : Math.max(
            100,
            Math.round(mockDataset.account.follower_count * baseMultiplier)
          )
      : null;

  const account: ScrapedAccountProfile = {
    ...mockDataset.account,
    username: requestedUsername,
    profile_url: requestedProfileUrl,
    display_name: isBaseMockAccount
      ? mockDataset.account.display_name
      : `${requestedUsername}（Fallback 示範資料）`,
    follower_count: scaledFollowerCount,
  };

  const posts: ScrapedPostRecord[] = mockDataset.posts
    .slice(0, Math.max(1, targetPostCount))
    .map((post, idx) => {
      const postWave = isBaseMockAccount
        ? 1
        : 0.9 + ((idx * 7 + requestedUsername.length) % 21) * 0.01;

      return {
        ...post,
        post_url: post.post_url.replace(
          `/@${mockDataset.account.username}/`,
          `/@${requestedUsername}/`
        ),
        like_count: isBaseMockAccount
          ? post.like_count
          : Math.max(1, Math.round(post.like_count * likeFactor * postWave)),
        reply_count: isBaseMockAccount
          ? post.reply_count
          : Math.max(0, Math.round(post.reply_count * replyFactor * postWave)),
        repost_count: isBaseMockAccount
          ? post.repost_count
          : Math.max(0, Math.round(post.repost_count * repostFactor * postWave)),
        quote_count: isBaseMockAccount
          ? post.quote_count
          : Math.max(0, Math.round(post.quote_count * quoteFactor * postWave)),
        hashtags: [...post.hashtags],
        mentions: [...post.mentions],
        raw_payload: {
          ...(post.raw_payload ?? {}),
          fallback_applied: true,
          original_mock_account: mockDataset.account.username,
          mock_multiplier: baseMultiplier,
        },
      };
    });

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