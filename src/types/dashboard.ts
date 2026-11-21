// src/types/dashboard.ts

export type DataSourceType = "live" | "cache" | "mock_fallback" | string;
export type TierKey = "high" | "medium" | "low";

export interface AccountInfo {
  username: string;
  profile_url: string;
  display_name: string;
  bio: string;
  follower_count: number;
}

export interface ReportMetrics {
  total_posts: number;
  total_likes: number;
  total_replies: number;
  total_reposts: number;
  total_quotes: number;
  total_engagement: number;
  avg_engagement: number;
  median_engagement: number;
  avg_char_count: number;
  duplicate_removed_count: number;
}

export interface HourlyDistributionItem {
  hour: number;
  label: string;
  post_count: number;
  avg_engagement: number;
}

export interface TimeSlotDistributionItem {
  slot: string;
  post_count: number;
  avg_engagement: number;
}

export interface WeekdayDistributionItem {
  weekday: string;
  post_count: number;
  avg_engagement: number;
}

export interface LengthBucketItem {
  bucket: string;
  post_count: number;
  avg_engagement: number;
}

export interface ChartSnapshots {
  hourly_distribution: HourlyDistributionItem[];
  time_slot_distribution: TimeSlotDistributionItem[];
  weekday_distribution: WeekdayDistributionItem[];
  feature_comparison: {
    with_question: { count: number; avg_engagement: number };
    without_question: { count: number; avg_engagement: number };
    with_media: { count: number; avg_engagement: number };
    text_only: { count: number; avg_engagement: number };
  };
  length_buckets: LengthBucketItem[];
}

export interface TierSummaryDetail {
  tier: TierKey;
  label: string;
  count: number;
  percentage: number;
  min_engagement: number;
  max_engagement: number;
  avg_engagement: number;
  median_engagement: number;
  avg_likes: number;
  avg_replies: number;
  avg_reposts: number;
  avg_quotes: number;
  avg_char_count: number;
  question_rate: number;
  media_rate: number;
  avg_engagement_rate: number;
  sample_post_ids: string[];
}

export interface SuccessFactor {
  title: string;
  description: string;
  hook_pattern?: string;
  evidence_post_ids: string[];
  impact_level: "high" | "medium" | "low" | string;
}

export interface FailureFactor {
  title: string;
  description: string;
  evidence_post_ids: string[];
  impact_level: "high" | "medium" | "low" | string;
}

export interface ContentObservation {
  dimension: string;
  finding: string;
  metric_evidence: string;
}

export interface AiRecommendation {
  priority: "P0" | "P1" | "P2" | string;
  title: string;
  action_steps: string[];
  example_hook?: string;
  expected_impact: string;
}

export interface PostItem {
  post_id: string;
  content: string;
  published_at: string;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  total_engagement: number;
  char_count?: number;
  has_question?: boolean;
  has_media?: boolean;
  tier?: TierKey;
  post_url?: string;
}

export interface AnalysisReport {
  task_id: string;
  generated_at: string;
  data_source: DataSourceType;
  cached?: boolean;
  account: AccountInfo;
  metrics: ReportMetrics;
  chart_snapshots: ChartSnapshots;
  high_tier_threshold: number;
  low_tier_threshold: number;
  tier_summary: {
    high: TierSummaryDetail;
    medium: TierSummaryDetail;
    low: TierSummaryDetail;
  };
  executive_summary: string;
  success_factors: SuccessFactor[];
  failure_factors: FailureFactor[];
  content_observations: ContentObservation[];
  ai_recommendations: AiRecommendation[];
  /** 若 POST /api/analyze 或 Supabase 同時回傳貼文明細，將自動供排行榜與趨勢圖使用 */
  posts?: PostItem[];
}