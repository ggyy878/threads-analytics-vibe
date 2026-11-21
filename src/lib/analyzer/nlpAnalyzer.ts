import { GoogleGenAI, Type, type Schema } from '@google/genai';
import {
  calculateMedian,
  type CleanedThreadsPost,
  type DataCleaningResult,
} from './dataCleaner';

export type EngagementTier = 'high' | 'medium' | 'low';

export interface TierStatSummary {
  tier: EngagementTier;
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
  avg_engagement_rate: number | null;
  sample_post_ids: string[];
}

export interface TierSummaryMap {
  high: TierStatSummary;
  medium: TierStatSummary;
  low: TierStatSummary;
}

export interface FactorInsight {
  title: string;
  description: string;
  evidence_post_ids: string[];
  hook_pattern?: string;
  impact_level: 'high' | 'medium' | 'low';
}

export interface ContentObservation {
  dimension: string;
  finding: string;
  metric_evidence: string;
}

export interface ActionableRecommendation {
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  action_steps: string[];
  example_hook: string;
  expected_impact: string;
}

export interface PostNlpInsight {
  post_id: string;
  tier: EngagementTier;
  hook_type: string;
  key_driver: string;
  improvement_tip: string;
}

export interface GeminiStructuredAnalysis {
  executive_summary: string;
  success_factors: FactorInsight[];
  failure_factors: FactorInsight[];
  content_observations: ContentObservation[];
  ai_recommendations: ActionableRecommendation[];
  post_insights: PostNlpInsight[];
}

export interface NlpAnalysisResult {
  posts: CleanedThreadsPost[];
  high_tier_threshold: number | null;
  low_tier_threshold: number | null;
  tier_summary: TierSummaryMap;
  executive_summary: string;
  success_factors: FactorInsight[];
  failure_factors: FactorInsight[];
  content_observations: ContentObservation[];
  ai_recommendations: ActionableRecommendation[];
  llm_model: string;
  prompt_version: string;
}

const DEFAULT_MODEL_CHAIN = [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
  ] as const;
  
  export const GEMINI_MODEL =
    process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL_CHAIN[0];
  export const PROMPT_VERSION = 'v1.1.0-structured-3tier-fallback';
  
  function getModelFallbackChain(): string[] {
    const customModel = process.env.GEMINI_MODEL?.trim();
    const candidates = customModel
      ? [customModel, ...DEFAULT_MODEL_CHAIN]
      : [...DEFAULT_MODEL_CHAIN];
    return Array.from(new Set(candidates));
  }

function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function getPostIdentifier(post: CleanedThreadsPost, index: number): string {
  return post.external_post_id || `post_${index + 1}`;
}

function buildTierStat(
  tier: EngagementTier,
  label: string,
  tierPosts: CleanedThreadsPost[],
  totalCount: number,
  sampleIds: string[]
): TierStatSummary {
  const count = tierPosts.length;
  if (count === 0) {
    return {
      tier,
      label,
      count: 0,
      percentage: 0,
      min_engagement: 0,
      max_engagement: 0,
      avg_engagement: 0,
      median_engagement: 0,
      avg_likes: 0,
      avg_replies: 0,
      avg_reposts: 0,
      avg_quotes: 0,
      avg_char_count: 0,
      question_rate: 0,
      media_rate: 0,
      avg_engagement_rate: null,
      sample_post_ids: [],
    };
  }

  const engagements = tierPosts.map((p) => p.total_engagement);
  const ratePosts = tierPosts.filter((p) => p.engagement_rate !== null);
  const avgEngagementRate =
    ratePosts.length > 0
      ? roundTo(
          ratePosts.reduce((sum, p) => sum + (p.engagement_rate ?? 0), 0) / ratePosts.length,
          2
        )
      : null;

  return {
    tier,
    label,
    count,
    percentage: totalCount > 0 ? roundTo((count / totalCount) * 100, 1) : 0,
    min_engagement: Math.min(...engagements),
    max_engagement: Math.max(...engagements),
    avg_engagement: roundTo(engagements.reduce((a, b) => a + b, 0) / count, 2),
    median_engagement: calculateMedian(engagements),
    avg_likes: roundTo(tierPosts.reduce((a, p) => a + p.like_count, 0) / count, 2),
    avg_replies: roundTo(tierPosts.reduce((a, p) => a + p.reply_count, 0) / count, 2),
    avg_reposts: roundTo(tierPosts.reduce((a, p) => a + p.repost_count, 0) / count, 2),
    avg_quotes: roundTo(tierPosts.reduce((a, p) => a + p.quote_count, 0) / count, 2),
    avg_char_count: roundTo(tierPosts.reduce((a, p) => a + p.char_count, 0) / count, 2),
    question_rate: roundTo(
      (tierPosts.filter((p) => p.has_question).length / count) * 100,
      1
    ),
    media_rate: roundTo((tierPosts.filter((p) => p.has_media).length / count) * 100, 1),
    avg_engagement_rate: avgEngagementRate,
    sample_post_ids: sampleIds,
  };
}

/**
 * 依據 total_engagement (like + reply + repost + quote) 進行三群組分群與代表性抽樣
 * - 每組抽樣 3~5 篇（依實際資料量上限調整），標記 is_nlp_sample = true
 */
export function segmentAndSamplePosts(
  cleanedPosts: CleanedThreadsPost[],
  samplePerTier = 4
): {
  segmentedPosts: CleanedThreadsPost[];
  highTierThreshold: number | null;
  lowTierThreshold: number | null;
  tierSummary: TierSummaryMap;
  sampledPosts: Array<{ postId: string; post: CleanedThreadsPost }>;
} {
  const clampedSampleSize = Math.min(5, Math.max(3, samplePerTier));

  const ranked = cleanedPosts
    .map((post, idx) => ({
      post: { ...post, engagement_tier: null as EngagementTier | null, is_nlp_sample: false },
      originalIndex: idx,
    }))
    .sort((a, b) => {
      if (b.post.total_engagement !== a.post.total_engagement) {
        return b.post.total_engagement - a.post.total_engagement;
      }
      if (b.post.reply_count !== a.post.reply_count) {
        return b.post.reply_count - a.post.reply_count;
      }
      return b.post.like_count - a.post.like_count;
    });

  const n = ranked.length;
  let highCount = 0;
  let lowCount = 0;

  if (n === 1) {
    highCount = 1;
    lowCount = 0;
  } else if (n === 2) {
    highCount = 1;
    lowCount = 1;
  } else if (n >= 3) {
    highCount = Math.max(1, Math.floor(n / 3));
    lowCount = Math.max(1, Math.floor(n / 3));
  }

  const highEndIdx = highCount;
  const lowStartIdx = n - lowCount;

  ranked.forEach((item, idx) => {
    if (idx < highEndIdx) {
      item.post.engagement_tier = 'high';
    } else if (idx >= lowStartIdx) {
      item.post.engagement_tier = 'low';
    } else {
      item.post.engagement_tier = 'medium';
    }
  });

  const highGroup = ranked.filter((r) => r.post.engagement_tier === 'high');
  const mediumGroup = ranked.filter((r) => r.post.engagement_tier === 'medium');
  const lowGroup = ranked.filter((r) => r.post.engagement_tier === 'low');

  const highTierThreshold =
    highGroup.length > 0
      ? highGroup[highGroup.length - 1].post.total_engagement
      : null;
  const lowTierThreshold =
    lowGroup.length > 0 ? lowGroup[0].post.total_engagement : null;

  const pickSamples = (
    group: typeof ranked,
    strategy: 'top' | 'middle' | 'bottom'
  ): typeof ranked => {
    if (group.length <= clampedSampleSize) return group;
    if (strategy === 'top') {
      return group.slice(0, clampedSampleSize);
    }
    if (strategy === 'bottom') {
      return group.slice(group.length - clampedSampleSize);
    }
    const start = Math.max(0, Math.floor((group.length - clampedSampleSize) / 2));
    return group.slice(start, start + clampedSampleSize);
  };

  const highSamples = pickSamples(highGroup, 'top');
  const mediumSamples = pickSamples(mediumGroup, 'middle');
  const lowSamples = pickSamples(lowGroup, 'bottom');

  const sampledAll = [...highSamples, ...mediumSamples, ...lowSamples];
  for (const item of sampledAll) {
    item.post.is_nlp_sample = true;
  }

  const highSampleIds = highSamples.map((s) =>
    getPostIdentifier(s.post, s.originalIndex)
  );
  const mediumSampleIds = mediumSamples.map((s) =>
    getPostIdentifier(s.post, s.originalIndex)
  );
  const lowSampleIds = lowSamples.map((s) =>
    getPostIdentifier(s.post, s.originalIndex)
  );

  const tierSummary: TierSummaryMap = {
    high: buildTierStat(
      'high',
      '高表現 (Top)',
      highGroup.map((g) => g.post),
      n,
      highSampleIds
    ),
    medium: buildTierStat(
      'medium',
      '中表現 (Mid)',
      mediumGroup.map((g) => g.post),
      n,
      mediumSampleIds
    ),
    low: buildTierStat(
      'low',
      '低表現 (Low)',
      lowGroup.map((g) => g.post),
      n,
      lowSampleIds
    ),
  };

  const segmentedPosts = ranked
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map((r) => r.post);

  const sampledPosts = sampledAll.map((s) => ({
    postId: getPostIdentifier(s.post, s.originalIndex),
    post: s.post,
  }));

  return {
    segmentedPosts,
    highTierThreshold,
    lowTierThreshold,
    tierSummary,
    sampledPosts,
  };
}

/**
 * Gemini Structured Output JSON Schema 定義
 */
const ANALYSIS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    executive_summary: {
      type: Type.STRING,
      description: '100~180 字的繁體中文總覽摘要，點出該帳號互動表現核心落差與成長機會。',
    },
    success_factors: {
      type: Type.ARRAY,
      description: '高表現群組 (Top) 的 3~4 個關鍵成功因素與高互動鉤子 (Hook) 特徵。',
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: '簡短精準的成功因素標題' },
          description: {
            type: Type.STRING,
            description: '具體分析為何該特徵能驅動高按讚、回覆或轉發',
          },
          hook_pattern: {
            type: Type.STRING,
            description: '拆解出的開頭鉤子句型或結構公式',
          },
          evidence_post_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '佐證此論點的抽樣貼文 post_id 清單',
          },
          impact_level: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
        },
        required: ['title', 'description', 'hook_pattern', 'evidence_post_ids', 'impact_level'],
      },
    },
    failure_factors: {
      type: Type.ARRAY,
      description: '低表現群組 (Low) 的 3~4 個互動低迷主因與避雷點。',
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: '失敗或低互動原因標題' },
          description: {
            type: Type.STRING,
            description: '分析內文結構、缺少痛點或缺乏互動引導等具體成因',
          },
          evidence_post_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '對應的低表現貼文 post_id 清單',
          },
          impact_level: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
        },
        required: ['title', 'description', 'evidence_post_ids', 'impact_level'],
      },
    },
    content_observations: {
      type: Type.ARRAY,
      description: '跨群組的數據與內容結構觀察（如字數、提問、多媒體、發文時段差異）。',
      items: {
        type: Type.OBJECT,
        properties: {
          dimension: {
            type: Type.STRING,
            description: '觀察面向（例如：字數與排版、問句引導、多媒體搭配、發文時段）',
          },
          finding: { type: Type.STRING, description: '具體趨勢發現與解讀' },
          metric_evidence: { type: Type.STRING, description: '引用輸入數據的具體數值佐證' },
        },
        required: ['dimension', 'finding', 'metric_evidence'],
      },
    },
    ai_recommendations: {
      type: Type.ARRAY,
      description: '3~5 條可直接執行的 Threads 內容優化策略建議（含改寫 Hook 示範）。',
      items: {
        type: Type.OBJECT,
        properties: {
          priority: { type: Type.STRING, enum: ['P0', 'P1', 'P2'] },
          title: { type: Type.STRING, description: '策略標題' },
          action_steps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '具體執行步驟（2~3 步）',
          },
          example_hook: {
            type: Type.STRING,
            description: '符合該帳號人設的具體示範開頭鉤子（Hook）文案',
          },
          expected_impact: {
            type: Type.STRING,
            description: '預期改善的指標（例如提升回覆率或轉發數）',
          },
        },
        required: ['priority', 'title', 'action_steps', 'example_hook', 'expected_impact'],
      },
    },
    post_insights: {
      type: Type.ARRAY,
      description: '針對每一篇抽樣貼文產出單篇診斷標籤，方便回寫至資料庫 posts.nlp_post_insights。',
      items: {
        type: Type.OBJECT,
        properties: {
          post_id: { type: Type.STRING },
          tier: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
          hook_type: {
            type: Type.STRING,
            description: '鉤子類型（例如：反常識觀點、痛點共鳴、清單干貨、日常流水帳）',
          },
          key_driver: {
            type: Type.STRING,
            description: '該篇表現優異或低迷的核心原因（30~60字）',
          },
          improvement_tip: {
            type: Type.STRING,
            description: '具體可優化方向（30~60字）',
          },
        },
        required: ['post_id', 'tier', 'hook_type', 'key_driver', 'improvement_tip'],
      },
    },
  },
  required: [
    'executive_summary',
    'success_factors',
    'failure_factors',
    'content_observations',
    'ai_recommendations',
    'post_insights',
  ],
};

async function withExponentialRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1200, label = 'Gemini API' } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const errMsg = error instanceof Error ? error.message : String(error);
      const isNonRetryable =
        errMsg.includes('API_KEY_INVALID') ||
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('INVALID_ARGUMENT') ||
        errMsg.includes('NOT_FOUND');

      if (isNonRetryable || attempt === maxRetries) {
        break;
      }

      const jitter = Math.floor(Math.random() * 300);
      const delayMs = baseDelayMs * 2 ** (attempt - 1) + jitter;
      console.warn(
        `[${label}] 第 ${attempt}/${maxRetries} 次呼叫失敗，${delayMs}ms 後重試：${errMsg}`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`[${label}] 呼叫失敗：${String(lastError)}`);
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`[${label}] 請求超過 ${timeoutMs}ms 逾時`));
      }, timeoutMs);
    });
  
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  
  /**
   * 最後防線：當所有 Gemini 模型皆遭遇 503/429 無法回應時，
   * 依據已計算的三群組統計特徵產出結構化報告，確保 API 不中斷
   */
  function buildRuleBasedFallbackAnalysis(
    cleaned: DataCleaningResult,
    tierSummary: TierSummaryMap,
    sampledPosts: Array<{ postId: string; post: CleanedThreadsPost }>
  ): GeminiStructuredAnalysis {
    const { high, low } = tierSummary;
    const highIds = high.sample_post_ids;
    const lowIds = low.sample_post_ids;
    const feat = cleaned.chart_snapshots.feature_comparison;
  
    const bestSlot = [...cleaned.chart_snapshots.time_slot_distribution].sort(
      (a, b) => b.avg_engagement - a.avg_engagement
    )[0];
  
    return {
      executive_summary: `帳號 @${cleaned.account.username} 共分析 ${cleaned.metrics.total_posts} 篇貼文，平均互動數 ${cleaned.metrics.avg_engagement}（中位數 ${cleaned.metrics.median_engagement}）。高表現群組平均互動達 ${high.avg_engagement}，為低表現群組（${low.avg_engagement}）的 ${low.avg_engagement > 0 ? roundTo(high.avg_engagement / low.avg_engagement, 1) : high.avg_engagement} 倍，顯示開頭鉤子、字數深度與互動提問設計對成效有顯著影響。（註：因 Gemini API 暫時壅塞，本次採統計規則自動降級產出）`,
      success_factors: [
        {
          title: '高資訊密度與完整觀點敘事',
          description: `高表現群組平均字數為 ${high.avg_char_count} 字，顯著高於低表現群組的 ${low.avg_char_count} 字，結構化的經驗拆解更能觸發轉發與收藏。`,
          hook_pattern: '反差觀察／實戰數據開場 ＋ 條列痛點拆解 ＋ 結尾收斂',
          evidence_post_ids: highIds,
          impact_level: 'high',
        },
        {
          title: '提問式結尾與多媒體輔助',
          description: `高表現群組含問句比例達 ${high.question_rate}%、多媒體搭配比例達 ${high.media_rate}%，有效降低讀者留言門檻並延長停留時間。`,
          hook_pattern: '附圖／案例說明 ＋ 開放式二選一提問',
          evidence_post_ids: highIds,
          impact_level: 'high',
        },
      ],
      failure_factors: [
        {
          title: '單向日常抒發缺乏讀者代入感',
          description: `低表現群組平均字數僅 ${low.avg_char_count} 字且問句比例為 ${low.question_rate}%，缺少具體議題切入點與討論誘因，導致回覆數偏低（平均 ${low.avg_replies} 則）。`,
          evidence_post_ids: lowIds,
          impact_level: 'high',
        },
      ],
      content_observations: [
        {
          dimension: '問句互動差異',
          finding:
            feat.with_question.avg_engagement >= feat.without_question.avg_engagement
              ? '包含問句的貼文整體互動表現優於未提問貼文。'
              : '純陳述觀點貼文互動不弱，但仍可於結尾補上互動引導提升留言。',
          metric_evidence: `含問句平均互動 ${feat.with_question.avg_engagement}（${feat.with_question.count} 篇）vs 無問句 ${feat.without_question.avg_engagement}（${feat.without_question.count} 篇）`,
        },
        {
          dimension: '多媒體素材效果',
          finding:
            feat.with_media.avg_engagement >= feat.text_only.avg_engagement
              ? '搭配圖片或輪播的貼文互動顯著領先純文字。'
              : '純文字觀點型貼文具備一定討論度，可針對乾貨文優先配圖。',
          metric_evidence: `含多媒體平均互動 ${feat.with_media.avg_engagement}（${feat.with_media.count} 篇）vs 純文字 ${feat.text_only.avg_engagement}（${feat.text_only.count} 篇）`,
        },
        {
          dimension: '發文時段（Asia/Taipei）',
          finding: `${bestSlot?.slot ?? '晚間 (18-23)'} 為目前互動表現最佳的發文區間。`,
          metric_evidence: `${bestSlot?.slot ?? '晚間 (18-23)'} 平均互動 ${bestSlot?.avg_engagement ?? 0}（共 ${bestSlot?.post_count ?? 0} 篇）`,
        },
      ],
      ai_recommendations: [
        {
          priority: 'P0',
          title: '複製高表現貼文的字數區間與問句結尾',
          action_steps: [
            `將主力貼文字數控制在 ${Math.max(80, Math.round(high.avg_char_count))} 字上下，前兩行直接拋出反常識或具體數字。`,
            '在貼文最後一句固定加入低門檻提問，引導讀者分享自身經驗。',
          ],
          example_hook: '做完這週的實測數據後，我發現九成人都忽略了一個最關鍵的細節——',
          expected_impact: '預期可提升貼文回覆率與整體演算法推播權重',
        },
        {
          priority: 'P1',
          title: '集中主力內容於高效時段發布並搭配視覺圖卡',
          action_steps: [
            `優先將高價值乾貨貼文排程在 ${bestSlot?.slot ?? '晚間 (18-23)'}（台灣時間）發布。`,
            '為重點整理型貼文補充清單截圖或 2~3 張輪播圖卡。',
          ],
          example_hook: '整理了 3 張實戰對照圖，直接看高互動跟低互動的差別在哪：',
          expected_impact: '提升曝光停留時間與轉發收藏數',
        },
      ],
      post_insights: sampledPosts.map(({ postId, post }) => ({
        post_id: postId,
        tier: post.engagement_tier ?? 'medium',
        hook_type: post.has_question
          ? '提問互動型'
          : post.has_media
            ? '視覺圖文型'
            : post.char_count <= 40
              ? '簡短日常型'
              : '觀點敘事型',
        key_driver: `總互動 ${post.total_engagement}（讚 ${post.like_count}／回覆 ${post.reply_count}），字數 ${post.char_count} 字${post.has_question ? '且具提問引導' : ''}。`,
        improvement_tip:
          post.engagement_tier === 'high'
            ? '保留此開頭節奏與資訊密度，可延伸為系列貼文。'
            : '建議強化前兩行鉤子並於文末加入具體提問以拉高留言數。',
      })),
    };
  }


function buildAnalysisPrompt(
  cleaned: DataCleaningResult,
  tierSummary: TierSummaryMap,
  sampledPosts: Array<{ postId: string; post: CleanedThreadsPost }>
): string {
  const compactSamples = sampledPosts.map(({ postId, post }) => ({
    post_id: postId,
    tier: post.engagement_tier,
    taipei_time: `${post.taipei_weekday} ${String(post.taipei_hour).padStart(2, '0')}:00 (${post.taipei_time_slot})`,
    metrics: {
      total_engagement: post.total_engagement,
      likes: post.like_count,
      replies: post.reply_count,
      reposts: post.repost_count,
      quotes: post.quote_count,
      views: post.view_count,
      engagement_rate_pct: post.engagement_rate,
      reply_ratio_pct: post.reply_ratio,
    },
    features: {
      char_count: post.char_count,
      has_question: post.has_question,
      has_media: post.has_media,
      media_type: post.media_type,
      hashtags: post.hashtags,
    },
    content: post.content.slice(0, 600),
  }));

  const payload = {
    account: cleaned.account,
    overall_metrics: cleaned.metrics,
    tier_summary: tierSummary,
    feature_comparison: cleaned.chart_snapshots.feature_comparison,
    time_slot_distribution: cleaned.chart_snapshots.time_slot_distribution,
    sampled_posts: compactSamples,
  };

  return [
    '你是一位資深社群內容成長分析師（專精 Threads 演算法與繁體中文內容策略）。',
    '請根據下方 JSON 數據，針對該 Threads 帳號的「高表現 (high)」、「中表現 (medium)」、「低表現 (low)」三群組進行深度成敗歸因分析。',
    '',
    '分析要求：',
    '1. 全部內容請使用「台灣繁體中文」，語氣專業、具體且數據導向，禁止空泛套話。',
    '2. 每個成功因素與失敗因素皆須引用對應抽樣貼文的 `post_id` 作為證據，並拆解高互動鉤子 (Hook) 的寫作結構。',
    '3. 在 `content_observations` 中結合字數、問句比例、多媒體類型與台灣時區 (Asia/Taipei) 發文時段數據提出具體對比。',
    '4. 在 `ai_recommendations` 中提供可立刻照做的策略步驟，並依據該帳號人設 (bio) 撰寫具體的示範開頭鉤子文案。',
    '5. `post_insights` 必須涵蓋 `sampled_posts` 裡的每一篇 `post_id`。',
    '',
    '=== 輸入數據 JSON ===',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

/**
 * Phase 4 & 5：三群組分群 + Gemini 2.5 Flash Structured Outputs 策略分析
 */
export async function analyzePostsWithNLP(
  cleaned: DataCleaningResult,
  options: { samplePerTier?: number; apiKey?: string } = {}
): Promise<NlpAnalysisResult> {
  if (cleaned.posts.length === 0) {
    throw new Error('無可供分析的貼文資料（清理後貼文數為 0）');
  }

  const {
    segmentedPosts,
    highTierThreshold,
    lowTierThreshold,
    tierSummary,
    sampledPosts,
  } = segmentAndSamplePosts(cleaned.posts, options.samplePerTier ?? 4);

  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少環境變數 GEMINI_API_KEY，請於 .env.local 設定後重試');
  }

  
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildAnalysisPrompt(cleaned, tierSummary, sampledPosts);
  const modelChain = getModelFallbackChain();

  let structuredOutput: GeminiStructuredAnalysis | null = null;
  let usedModel: string = GEMINI_MODEL;
  let lastModelError: unknown = null;

  for (const modelName of modelChain) {
    try {
      structuredOutput = await withExponentialRetry<GeminiStructuredAnalysis>(
        async () => {
          const response = await withTimeout(
            ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                systemInstruction:
                  '你是精準的 Threads 社群數據與 NLP 內容策略專家。嚴格依照指定的 JSON Schema 回傳繁體中文結構化分析結果，不得輸出任何額外 Markdown 標記。',
                responseMimeType: 'application/json',
                responseSchema: ANALYSIS_RESPONSE_SCHEMA,
              },
            }),
            18_000,
            `Gemini ${modelName}`
          );

          const rawText = response.text?.trim();
          if (!rawText) {
            throw new Error('Gemini 回傳空白內容');
          }

          const parsed = JSON.parse(rawText) as GeminiStructuredAnalysis;
          if (
            !Array.isArray(parsed.success_factors) ||
            !Array.isArray(parsed.failure_factors) ||
            !Array.isArray(parsed.ai_recommendations)
          ) {
            throw new Error('Gemini 結構化 JSON 缺少必要欄位');
          }

          return parsed;
        },
        { maxRetries: 2, baseDelayMs: 800, label: `Gemini (${modelName})` }
      );

      usedModel = modelName;
      break;
    } catch (error) {
      lastModelError = error;
      console.warn(
        `[NLP] 模型 ${modelName} 呼叫失敗，準備切換下一個備援模型：`,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (!structuredOutput) {
    const allowRuleFallback =
      (process.env.ENABLE_LLM_FALLBACK ?? 'true').trim().toLowerCase() !== 'false';

    if (!allowRuleFallback) {
      throw lastModelError instanceof Error
        ? lastModelError
        : new Error('所有 Gemini 模型皆呼叫失敗');
    }

    console.warn(
      '[NLP] 所有 Gemini 模型暫時無法使用，已自動降級為統計規則分析報告。'
    );
    structuredOutput = buildRuleBasedFallbackAnalysis(
      cleaned,
      tierSummary,
      sampledPosts
    );
    usedModel = 'rule-based-fallback';
  }

// 將單篇 NLP 診斷回寫至對應抽樣貼文的 nlp_post_insights
const insightByPostId = new Map<string, PostNlpInsight>();
for (const item of structuredOutput.post_insights ?? []) {
  insightByPostId.set(item.post_id, item);
}

  const enrichedPosts = segmentedPosts.map((post, idx) => {
    const pid = getPostIdentifier(post, idx);
    const matchedInsight = insightByPostId.get(pid);
    if (!matchedInsight) return post;

    return {
        ...post,
        nlp_post_insights: {
          hook_type: matchedInsight.hook_type,
          key_driver: matchedInsight.key_driver,
          improvement_tip: matchedInsight.improvement_tip,
          analyzed_model: usedModel,
          prompt_version: PROMPT_VERSION,
        },
      };
  });

  return {
    posts: enrichedPosts,
    high_tier_threshold: highTierThreshold,
    low_tier_threshold: lowTierThreshold,
    tier_summary: tierSummary,
    executive_summary: structuredOutput.executive_summary,
    success_factors: structuredOutput.success_factors,
    failure_factors: structuredOutput.failure_factors,
    content_observations: structuredOutput.content_observations,
    ai_recommendations: structuredOutput.ai_recommendations,
    llm_model: usedModel,
    prompt_version: PROMPT_VERSION,
  };
}