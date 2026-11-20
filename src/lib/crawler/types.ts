// 對應 SQL ENUM: public.data_source_type
export type DataSourceType = "playwright" | "mock_fallback" | "cache";

// 對應 SQL ENUM: public.engagement_tier_type
export type EngagementTier = "high" | "medium" | "low";

// 對應 SQL TABLE: public.threads_accounts 的可爬取欄位
export interface ScrapedAccountProfile {
  username: string;
  profile_url: string;
  display_name: string | null;
  bio: string | null;
  follower_count: number | null;
}

// 對應 SQL TABLE: public.posts（扣除 DB 自動生成與外鍵欄位：id, task_id, account_id, user_id, total_engagement, created_at）
export interface ScrapedPostRecord {
  external_post_id: string | null;
  post_url: string;
  content: string;
  published_at: string; // UTC ISO 8601 (TIMESTAMPTZ)
  like_count: number;
  reply_count: number;
  repost_count: number;
  quote_count: number;
  view_count: number | null;
  char_count: number;
  hashtag_count: number;
  mention_count: number;
  url_count: number;
  hashtags: string[];
  mentions: string[];
  engagement_tier: EngagementTier | null;
  is_nlp_sample: boolean;
  nlp_post_insights: Record<string, unknown> | null;
  raw_payload: Record<string, unknown> | null;
}

// 直接對應 Supabase public.posts INSERT Payload
export interface PostInsertRow extends ScrapedPostRecord {
  task_id: string;
  account_id: string;
  user_id: string;
}

export interface MockDatasetSchema {
  account: ScrapedAccountProfile;
  posts: ScrapedPostRecord[];
}

export interface CrawlOptions {
  /** 目標抓取貼文數，對應 analysis_tasks.target_post_count（預設 30） */
  targetPostCount?: number;
  /** 覆寫環境變數 PLAYWRIGHT_TIMEOUT_MS（毫秒） */
  timeoutMs?: number;
  /** 單次呼叫強制啟用 Mock Fallback */
  forceMockFallback?: boolean;
  /** 是否無頭模式執行（預設 true） */
  headless?: boolean;
}

export interface CrawlResult {
  account: ScrapedAccountProfile;
  posts: ScrapedPostRecord[];
  data_source: Exclude<DataSourceType, "cache">;
  is_fallback_used: boolean;
  fallback_reason: string | null;
  fetched_post_count: number;
  duration_ms: number;
}

export type CrawlerErrorCode =
  | "INVALID_INPUT"
  | "LOGIN_WALL"
  | "ANTI_BOT_BLOCKED"
  | "ACCOUNT_NOT_FOUND"
  | "TIMEOUT"
  | "EMPTY_RESULT"
  | "BROWSER_LAUNCH_FAILED"
  | "UNKNOWN";

export class ThreadsCrawlerError extends Error {
  public readonly code: CrawlerErrorCode;

  constructor(code: CrawlerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ThreadsCrawlerError";
    this.code = code;
  }
}