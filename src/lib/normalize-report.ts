// src/lib/normalize-report.ts

import type { AnalysisReport, PostItem, TierKey } from "@/types/dashboard";

type AnyRecord = Record<string, unknown>;

function toNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePost(raw: AnyRecord): PostItem {
  const likes = toNumber(raw.likes ?? raw.like_count);
  const replies = toNumber(raw.replies ?? raw.reply_count);
  const reposts = toNumber(raw.reposts ?? raw.repost_count);
  const quotes = toNumber(raw.quotes ?? raw.quote_count);
  const totalEngagement = toNumber(
    raw.total_engagement ?? raw.engagement_score,
    likes + replies + reposts + quotes
  );

  const rawTier = (raw.tier ?? raw.performance_tier) as string | undefined;
  const tier: TierKey | undefined =
    rawTier === "high" || rawTier === "medium" || rawTier === "low"
      ? rawTier
      : undefined;

  return {
    post_id: String(raw.post_id ?? raw.external_post_id ?? raw.id ?? ""),
    content: String(raw.content ?? raw.text ?? ""),
    published_at: String(
      raw.published_at ?? raw.posted_at ?? raw.created_at ?? ""
    ),
    likes,
    replies,
    reposts,
    quotes,
    total_engagement: totalEngagement,
    char_count:
      raw.char_count !== undefined ? toNumber(raw.char_count) : undefined,
    has_question:
      typeof raw.has_question === "boolean" ? raw.has_question : undefined,
    has_media: typeof raw.has_media === "boolean" ? raw.has_media : undefined,
    tier,
    post_url: (raw.post_url ?? raw.url) as string | undefined,
  };
}

/**
 * 將 POST /api/analyze 回傳（或 Supabase 扁平資料列）統一轉換成前端儀表板使用的 AnalysisReport
 */
export function normalizeAnalyzeResponse(
  payload: AnyRecord,
  fallbackUsername?: string
): AnalysisReport | null {
  const dataObj =
    payload.data && typeof payload.data === "object"
      ? (payload.data as AnyRecord)
      : null;

  // 取出主報表物件（兼容 { report }、{ data: { report } }、或扁平回傳）
  const rawReport = (payload.report ??
    dataObj?.report ??
    payload.data ??
    payload) as AnyRecord | null;

  if (!rawReport || typeof rawReport !== "object") return null;

  // 1. 帳號資訊：優先取 payload.account / data.account / report.account，都沒有就用使用者輸入的帳號補齊
  const rawAccount = (payload.account ??
    dataObj?.account ??
    rawReport.account ??
    {}) as AnyRecord;

  const username = String(
    rawAccount.username ??
      rawReport.username ??
      payload.username ??
      fallbackUsername ??
      ""
  ).replace(/^@+/, "");

  if (!username) return null;

  // 2. 指標資訊：同時支援巢狀 report.metrics 與扁平欄位
  const rawMetrics = (rawReport.metrics ?? rawReport) as AnyRecord;

  // 3. tier_summary 與 executive_summary
  const rawTierSummary = (rawReport.tier_summary ?? {}) as AnyRecord;
  const executiveSummary = String(
    rawReport.executive_summary ?? rawTierSummary.executive_summary ?? ""
  );

  // 4. 貼文明細
  const rawPosts = (payload.posts ??
    dataObj?.posts ??
    rawReport.posts ??
    []) as AnyRecord[];

  const posts = Array.isArray(rawPosts) ? rawPosts.map(normalizePost) : [];

  const cached = Boolean(
    payload.cached ?? dataObj?.cached ?? rawReport.cached ?? false
  );
  const dataSource = String(
    payload.data_source ??
      dataObj?.data_source ??
      rawReport.data_source ??
      (cached ? "cache" : "live")
  );

  return {
    task_id: String(rawReport.task_id ?? rawReport.id ?? ""),
    generated_at: String(
      rawReport.generated_at ??
        rawReport.updated_at ??
        rawReport.created_at ??
        new Date().toISOString()
    ),
    data_source: dataSource,
    cached,
    account: {
      username,
      profile_url: String(
        rawAccount.profile_url ?? `https://www.threads.net/@${username}`
      ),
      display_name: String(rawAccount.display_name ?? username),
      bio: String(rawAccount.bio ?? ""),
      follower_count: toNumber(rawAccount.follower_count, 0),
    },
    metrics: {
      total_posts: toNumber(rawMetrics.total_posts),
      total_likes: toNumber(rawMetrics.total_likes),
      total_replies: toNumber(rawMetrics.total_replies),
      total_reposts: toNumber(rawMetrics.total_reposts),
      total_quotes: toNumber(rawMetrics.total_quotes),
      total_engagement: toNumber(rawMetrics.total_engagement),
      avg_engagement: toNumber(rawMetrics.avg_engagement),
      median_engagement: toNumber(rawMetrics.median_engagement),
      avg_char_count: toNumber(rawMetrics.avg_char_count),
      duplicate_removed_count: toNumber(rawMetrics.duplicate_removed_count, 0),
    },
    chart_snapshots:
      rawReport.chart_snapshots as AnalysisReport["chart_snapshots"],
    high_tier_threshold: toNumber(rawReport.high_tier_threshold),
    low_tier_threshold: toNumber(rawReport.low_tier_threshold),
    tier_summary: {
      high: rawTierSummary.high as AnalysisReport["tier_summary"]["high"],
      medium: rawTierSummary.medium as AnalysisReport["tier_summary"]["medium"],
      low: rawTierSummary.low as AnalysisReport["tier_summary"]["low"],
    },
    executive_summary: executiveSummary,
    success_factors: (rawReport.success_factors ??
      []) as AnalysisReport["success_factors"],
    failure_factors: (rawReport.failure_factors ??
      []) as AnalysisReport["failure_factors"],
    content_observations: (rawReport.content_observations ??
      []) as AnalysisReport["content_observations"],
    ai_recommendations: (rawReport.ai_recommendations ??
      []) as AnalysisReport["ai_recommendations"],
    posts,
  };
}