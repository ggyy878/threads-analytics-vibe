export interface RawThreadsAccount {
    username: string;
    profile_url: string;
    display_name?: string | null;
    bio?: string | null;
    follower_count?: number | null;
  }
  
  export interface RawPostPayload {
    source?: string;
    media_type?: string;
    has_image?: boolean;
    has_video?: boolean;
    has_question?: boolean;
    expected_tier_hint?: string;
    [key: string]: unknown;
  }
  
  export interface RawThreadsPost {
    external_post_id?: string | null;
    post_url: string;
    content?: string | null;
    published_at?: string | null;
    like_count?: number | null;
    reply_count?: number | null;
    repost_count?: number | null;
    quote_count?: number | null;
    view_count?: number | null;
    char_count?: number | null;
    hashtag_count?: number | null;
    mention_count?: number | null;
    url_count?: number | null;
    hashtags?: string[] | null;
    mentions?: string[] | null;
    engagement_tier?: 'high' | 'medium' | 'low' | null;
    is_nlp_sample?: boolean | null;
    nlp_post_insights?: Record<string, unknown> | null;
    raw_payload?: RawPostPayload | null;
  }
  
  export type TimeSlotLabel = '凌晨 (00-05)' | '上午 (06-11)' | '下午 (12-17)' | '晚間 (18-23)';
  
  export interface CleanedThreadsPost {
    external_post_id: string | null;
    post_url: string;
    content: string;
    /** 寫入 Supabase TIMESTAMPTZ 使用 ISO 8601 UTC 格式 */
    published_at: string;
    /** Asia/Taipei 本地時間資訊（用於發文時段統計與報表） */
    taipei_published_at: string;
    taipei_hour: number;
    taipei_weekday: string;
    taipei_time_slot: TimeSlotLabel;
    like_count: number;
    reply_count: number;
    repost_count: number;
    quote_count: number;
    view_count: number | null;
    total_engagement: number;
    /** 互動率 (%)：優先使用 view_count，若無曝光數則退回 follower_count */
    engagement_rate: number | null;
    engagement_rate_basis: 'views' | 'followers' | 'none';
    engagement_rate_by_views: number | null;
    engagement_rate_by_followers: number | null;
    reply_ratio: number;
    char_count: number;
    hashtag_count: number;
    mention_count: number;
    url_count: number;
    hashtags: string[];
    mentions: string[];
    has_question: boolean;
    has_media: boolean;
    media_type: string;
    engagement_tier: 'high' | 'medium' | 'low' | null;
    is_nlp_sample: boolean;
    nlp_post_insights: Record<string, unknown> | null;
    raw_payload: Record<string, unknown>;
  }
  
  export interface AggregateMetrics {
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
  
  export interface ChartSnapshots {
    hourly_distribution: Array<{
      hour: number;
      label: string;
      post_count: number;
      avg_engagement: number;
    }>;
    time_slot_distribution: Array<{
      slot: TimeSlotLabel;
      post_count: number;
      avg_engagement: number;
    }>;
    weekday_distribution: Array<{
      weekday: string;
      post_count: number;
      avg_engagement: number;
    }>;
    feature_comparison: {
      with_question: { count: number; avg_engagement: number };
      without_question: { count: number; avg_engagement: number };
      with_media: { count: number; avg_engagement: number };
      text_only: { count: number; avg_engagement: number };
    };
    length_buckets: Array<{
      bucket: string;
      post_count: number;
      avg_engagement: number;
    }>;
  }
  
  export interface DataCleaningResult {
    account: {
      username: string;
      profile_url: string;
      display_name: string | null;
      bio: string | null;
      follower_count: number | null;
    };
    posts: CleanedThreadsPost[];
    metrics: AggregateMetrics;
    chart_snapshots: ChartSnapshots;
  }
  
  const TAIPEI_TIMEZONE = 'Asia/Taipei';
  const WEEKDAY_MAP: Record<string, string> = {
    Mon: '週一',
    Tue: '週二',
    Wed: '週三',
    Thu: '週四',
    Fri: '週五',
    Sat: '週六',
    Sun: '週日',
  };
  const WEEKDAY_ORDER = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  const TIME_SLOT_ORDER: TimeSlotLabel[] = [
    '凌晨 (00-05)',
    '上午 (06-11)',
    '下午 (12-17)',
    '晚間 (18-23)',
  ];
  
  function roundTo(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
  
  function toSafeNonNegativeInt(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.round(parsed));
      }
    }
    return fallback;
  }
  
  function toNullableNonNegativeInt(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = toSafeNonNegativeInt(value, -1);
    return parsed >= 0 ? parsed : null;
  }
  
  function normalizePostUrl(url: string): string {
    const trimmed = url.trim();
    try {
      const parsed = new URL(trimmed);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return trimmed.replace(/\/+$/, '');
    }
  }
  
  function normalizeTimestamp(rawDate: string | null | undefined): {
    utcIso: string;
    taipeiIso: string;
    taipeiHour: number;
    taipeiWeekday: string;
    taipeiTimeSlot: TimeSlotLabel;
  } {
    let date = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(date.getTime())) {
      date = new Date();
    }
  
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TAIPEI_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
  
    const parts = formatter.formatToParts(date);
    const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? '00';
  
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hourNum = Number(getPart('hour')) % 24;
    const hourStr = String(hourNum).padStart(2, '0');
    const minute = getPart('minute');
    const second = getPart('second');
    const weekdayShort = getPart('weekday');
  
    const taipeiWeekday = WEEKDAY_MAP[weekdayShort] ?? weekdayShort;
    const taipeiTimeSlot: TimeSlotLabel =
      hourNum < 6
        ? '凌晨 (00-05)'
        : hourNum < 12
          ? '上午 (06-11)'
          : hourNum < 18
            ? '下午 (12-17)'
            : '晚間 (18-23)';
  
    return {
      utcIso: date.toISOString(),
      taipeiIso: `${year}-${month}-${day}T${hourStr}:${minute}:${second}+08:00`,
      taipeiHour: hourNum,
      taipeiWeekday,
      taipeiTimeSlot,
    };
  }
  
  function extractTextFeatures(content: string): {
    charCount: number;
    hashtags: string[];
    mentions: string[];
    urlCount: number;
    hasQuestion: boolean;
  } {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const charCount = Array.from(normalized).length;
  
    const hashtagMatches = normalized.matchAll(/#([\p{L}\p{N}_]+)/gu);
    const hashtags = Array.from(new Set(Array.from(hashtagMatches, (m) => m[1])));
  
    const mentionMatches = normalized.matchAll(/(?:^|[^\p{L}\p{N}_.])@([A-Za-z0-9._]+)/gu);
    const mentions = Array.from(new Set(Array.from(mentionMatches, (m) => m[1])));
  
    const urlMatches = normalized.match(/https?:\/\/[^\s]+/gi) ?? [];
    const urlCount = urlMatches.length;
  
    const hasQuestion =
      /[?？]/.test(normalized) ||
      /(嗎|呢|怎麼|如何|為什麼|為何|哪一個|哪一題|有沒有|是不是|覺得呢)([!！。\s]|$)/.test(
        normalized
      );
  
    return {
      charCount,
      hashtags,
      mentions,
      urlCount,
      hasQuestion,
    };
  }
  
  function detectMediaInfo(rawPayload: RawPostPayload | null | undefined): {
    hasMedia: boolean;
    mediaType: string;
  } {
    const mediaTypeRaw =
      typeof rawPayload?.media_type === 'string' && rawPayload.media_type.trim() !== ''
        ? rawPayload.media_type.trim().toLowerCase()
        : 'text';
  
    const hasMedia =
      rawPayload?.has_image === true ||
      rawPayload?.has_video === true ||
      (mediaTypeRaw !== 'text' && mediaTypeRaw !== 'none');
  
    return {
      hasMedia,
      mediaType: hasMedia && mediaTypeRaw === 'text' ? 'image' : mediaTypeRaw,
    };
  }
  
  export function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return roundTo((sorted[mid - 1] + sorted[mid]) / 2, 2);
    }
    return roundTo(sorted[mid], 2);
  }
  
  function buildChartSnapshots(posts: CleanedThreadsPost[]): ChartSnapshots {
    // 1. 24 小時發文與互動分布 (Asia/Taipei)
    const hourlyMap = new Map<number, { count: number; totalEng: number }>();
    for (let h = 0; h < 24; h += 1) {
      hourlyMap.set(h, { count: 0, totalEng: 0 });
    }
    for (const post of posts) {
      const entry = hourlyMap.get(post.taipei_hour)!;
      entry.count += 1;
      entry.totalEng += post.total_engagement;
    }
    const hourly_distribution = Array.from(hourlyMap.entries()).map(([hour, stat]) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      post_count: stat.count,
      avg_engagement: stat.count > 0 ? roundTo(stat.totalEng / stat.count, 2) : 0,
    }));
  
    // 2. 四時段分布
    const time_slot_distribution = TIME_SLOT_ORDER.map((slot) => {
      const group = posts.filter((p) => p.taipei_time_slot === slot);
      const sum = group.reduce((acc, p) => acc + p.total_engagement, 0);
      return {
        slot,
        post_count: group.length,
        avg_engagement: group.length > 0 ? roundTo(sum / group.length, 2) : 0,
      };
    });
  
    // 3. 星期分布
    const weekday_distribution = WEEKDAY_ORDER.map((weekday) => {
      const group = posts.filter((p) => p.taipei_weekday === weekday);
      const sum = group.reduce((acc, p) => acc + p.total_engagement, 0);
      return {
        weekday,
        post_count: group.length,
        avg_engagement: group.length > 0 ? roundTo(sum / group.length, 2) : 0,
      };
    });
  
    // 4. 問句與多媒體互動對比
    const avgEng = (list: CleanedThreadsPost[]): number =>
      list.length > 0
        ? roundTo(list.reduce((acc, p) => acc + p.total_engagement, 0) / list.length, 2)
        : 0;
  
    const withQ = posts.filter((p) => p.has_question);
    const withoutQ = posts.filter((p) => !p.has_question);
    const withMedia = posts.filter((p) => p.has_media);
    const textOnly = posts.filter((p) => !p.has_media);
  
    // 5. 字數區間分布
    const buckets = [
      { label: '短文 (≤50字)', match: (n: number) => n <= 50 },
      { label: '中短文 (51-120字)', match: (n: number) => n >= 51 && n <= 120 },
      { label: '中長文 (121-250字)', match: (n: number) => n >= 121 && n <= 250 },
      { label: '長文 (>250字)', match: (n: number) => n > 250 },
    ];
  
    const length_buckets = buckets.map((b) => {
      const group = posts.filter((p) => b.match(p.char_count));
      return {
        bucket: b.label,
        post_count: group.length,
        avg_engagement: avgEng(group),
      };
    });
  
    return {
      hourly_distribution,
      time_slot_distribution,
      weekday_distribution,
      feature_comparison: {
        with_question: { count: withQ.length, avg_engagement: avgEng(withQ) },
        without_question: { count: withoutQ.length, avg_engagement: avgEng(withoutQ) },
        with_media: { count: withMedia.length, avg_engagement: avgEng(withMedia) },
        text_only: { count: textOnly.length, avg_engagement: avgEng(textOnly) },
      },
      length_buckets,
    };
  }
  
  /**
   * Phase 4 資料清理與特徵提取主函式
   * - 依 external_post_id / post_url 去重（重複時保留互動數較高或內容較完整者）
   * - 統一時間為 UTC ISO (入庫) 與 Asia/Taipei (時段分析)
   * - 提取字數、Hashtag、Mention、URL、問句、多媒體與互動率特徵
   */
  export function cleanAndExtractPosts(
    rawAccount: RawThreadsAccount,
    rawPosts: RawThreadsPost[]
  ): DataCleaningResult {
    const cleanUsername = rawAccount.username.trim().replace(/^@+/, '').toLowerCase();
    const followerCount = toNullableNonNegativeInt(rawAccount.follower_count);
  
    const normalizedAccount = {
      username: cleanUsername,
      profile_url:
        rawAccount.profile_url?.trim() || `https://www.threads.net/@${cleanUsername}`,
      display_name: rawAccount.display_name?.trim() || null,
      bio: rawAccount.bio?.trim() || null,
      follower_count: followerCount,
    };
  
    const dedupMap = new Map<string, CleanedThreadsPost>();
    const urlToKeyMap = new Map<string, string>();
    let duplicateRemovedCount = 0;
  
    for (const raw of rawPosts) {
      if (!raw || (!raw.post_url && !raw.external_post_id)) {
        continue;
      }
  
      const externalId = raw.external_post_id?.trim() || null;
      const postUrl = normalizePostUrl(
        raw.post_url || `https://www.threads.net/@${cleanUsername}/post/${externalId}`
      );
  
      const content = (raw.content ?? '').replace(/\r\n/g, '\n').trim();
      const timeInfo = normalizeTimestamp(raw.published_at);
  
      const likeCount = toSafeNonNegativeInt(raw.like_count, 0);
      const replyCount = toSafeNonNegativeInt(raw.reply_count, 0);
      const repostCount = toSafeNonNegativeInt(raw.repost_count, 0);
      const quoteCount = toSafeNonNegativeInt(raw.quote_count, 0);
      const viewCount = toNullableNonNegativeInt(raw.view_count);
      const totalEngagement = likeCount + replyCount + repostCount + quoteCount;
  
      const textFeatures = extractTextFeatures(content);
      const mediaInfo = detectMediaInfo(raw.raw_payload);
      const hasQuestion =
        typeof raw.raw_payload?.has_question === 'boolean'
          ? raw.raw_payload.has_question || textFeatures.hasQuestion
          : textFeatures.hasQuestion;
  
      const engagementRateByViews =
        viewCount !== null && viewCount > 0
          ? roundTo((totalEngagement / viewCount) * 100, 2)
          : null;
      const engagementRateByFollowers =
        followerCount !== null && followerCount > 0
          ? roundTo((totalEngagement / followerCount) * 100, 2)
          : null;
  
      const engagementRateBasis: 'views' | 'followers' | 'none' =
        engagementRateByViews !== null
          ? 'views'
          : engagementRateByFollowers !== null
            ? 'followers'
            : 'none';
  
      const engagementRate =
        engagementRateBasis === 'views'
          ? engagementRateByViews
          : engagementRateBasis === 'followers'
            ? engagementRateByFollowers
            : null;
  
      const replyRatio =
        totalEngagement > 0 ? roundTo((replyCount / totalEngagement) * 100, 2) : 0;
  
      const mergedRawPayload: Record<string, unknown> = {
        ...(raw.raw_payload ?? {}),
        cleaned_features: {
          has_question: hasQuestion,
          has_media: mediaInfo.hasMedia,
          media_type: mediaInfo.mediaType,
          engagement_rate: engagementRate,
          engagement_rate_basis: engagementRateBasis,
          engagement_rate_by_views: engagementRateByViews,
          engagement_rate_by_followers: engagementRateByFollowers,
          reply_ratio: replyRatio,
          taipei_published_at: timeInfo.taipeiIso,
          taipei_hour: timeInfo.taipeiHour,
          taipei_weekday: timeInfo.taipeiWeekday,
          taipei_time_slot: timeInfo.taipeiTimeSlot,
        },
      };
  
      const cleaned: CleanedThreadsPost = {
        external_post_id: externalId,
        post_url: postUrl,
        content,
        published_at: timeInfo.utcIso,
        taipei_published_at: timeInfo.taipeiIso,
        taipei_hour: timeInfo.taipeiHour,
        taipei_weekday: timeInfo.taipeiWeekday,
        taipei_time_slot: timeInfo.taipeiTimeSlot,
        like_count: likeCount,
        reply_count: replyCount,
        repost_count: repostCount,
        quote_count: quoteCount,
        view_count: viewCount,
        total_engagement: totalEngagement,
        engagement_rate: engagementRate,
        engagement_rate_basis: engagementRateBasis,
        engagement_rate_by_views: engagementRateByViews,
        engagement_rate_by_followers: engagementRateByFollowers,
        reply_ratio: replyRatio,
        char_count: textFeatures.charCount,
        hashtag_count: textFeatures.hashtags.length,
        mention_count: textFeatures.mentions.length,
        url_count: textFeatures.urlCount,
        hashtags: textFeatures.hashtags,
        mentions: textFeatures.mentions,
        has_question: hasQuestion,
        has_media: mediaInfo.hasMedia,
        media_type: mediaInfo.mediaType,
        engagement_tier: null,
        is_nlp_sample: false,
        nlp_post_insights: null,
        raw_payload: mergedRawPayload,
      };
  
      const primaryKey = externalId ? `id:${externalId}` : `url:${postUrl.toLowerCase()}`;
      const existingKeyByUrl = urlToKeyMap.get(postUrl.toLowerCase());
      const resolvedKey = dedupMap.has(primaryKey)
        ? primaryKey
        : existingKeyByUrl ?? primaryKey;
  
      const existing = dedupMap.get(resolvedKey);
      if (existing) {
        duplicateRemovedCount += 1;
        const shouldReplace =
          cleaned.total_engagement > existing.total_engagement ||
          (cleaned.total_engagement === existing.total_engagement &&
            cleaned.char_count > existing.char_count);
        if (shouldReplace) {
          dedupMap.set(resolvedKey, cleaned);
        }
      } else {
        dedupMap.set(resolvedKey, cleaned);
        urlToKeyMap.set(postUrl.toLowerCase(), resolvedKey);
      }
    }
  
    const posts = Array.from(dedupMap.values()).sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  
    const totalPosts = posts.length;
    const totalLikes = posts.reduce((acc, p) => acc + p.like_count, 0);
    const totalReplies = posts.reduce((acc, p) => acc + p.reply_count, 0);
    const totalReposts = posts.reduce((acc, p) => acc + p.repost_count, 0);
    const totalQuotes = posts.reduce((acc, p) => acc + p.quote_count, 0);
    const totalEngagement = posts.reduce((acc, p) => acc + p.total_engagement, 0);
    const totalChars = posts.reduce((acc, p) => acc + p.char_count, 0);
  
    const metrics: AggregateMetrics = {
      total_posts: totalPosts,
      total_likes: totalLikes,
      total_replies: totalReplies,
      total_reposts: totalReposts,
      total_quotes: totalQuotes,
      total_engagement: totalEngagement,
      avg_engagement: totalPosts > 0 ? roundTo(totalEngagement / totalPosts, 2) : 0,
      median_engagement: calculateMedian(posts.map((p) => p.total_engagement)),
      avg_char_count: totalPosts > 0 ? roundTo(totalChars / totalPosts, 2) : 0,
      duplicate_removed_count: duplicateRemovedCount,
    };
  
    return {
      account: normalizedAccount,
      posts,
      metrics,
      chart_snapshots: buildChartSnapshots(posts),
    };
  }